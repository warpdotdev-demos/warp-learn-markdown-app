import fs from "node:fs/promises";
import path from "node:path";
import { SourceMapConsumer } from "source-map-js";
import type { IncomingEvent, IncomingFrame } from "./eventSchema.js";

// Resolves bundled stack frames (Marky's renderer bundle, packages/ui's dist,
// Vite dev-server modules) back to original files, lines, and function names,
// so issues group by real code and the fix agent sees where to look.
//
// Maps are only read from files under the configured source roots or fetched
// from a localhost dev server, never from arbitrary hosts.

const SOURCE_MAPPING_URL =
	/\/[/*][#@]\s*sourceMappingURL=([^\s'"*]+)\s*(?:\*\/)?\s*$/gm;
const LOCAL_HOSTS = new Set(["localhost", "*********", "[::1]"]);
const FETCH_TIMEOUT_MS = 2000;
const CONTROL_KEYWORDS = /\b(?:if|for|while|switch|catch|with)\s*$/;
const NOT_NAMES = new Set(["function", "return", "await", "new", "typeof"]);

type LoadedMap = {
	consumer: SourceMapConsumer;
	/** Where relative `sources` resolve from: a directory path or a URL. */
	base: string;
};

export type Symbolicator = {
	symbolicate: (event: IncomingEvent) => Promise<IncomingEvent>;
};

export function createSymbolicator(options: {
	roots: string[];
	fetch?: typeof fetch;
}): Symbolicator {
	const roots = options.roots.map((root) => path.resolve(root));
	const fetchImpl = options.fetch ?? globalThis.fetch;
	const cache = new Map<string, Promise<LoadedMap | null>>();

	const withinRoots = (file: string) =>
		roots.some(
			(root) => file === root || file.startsWith(`${root}${path.sep}`),
		);

	const displayPath = (file: string) => {
		const root = roots.find((candidate) =>
			file.startsWith(`${candidate}${path.sep}`),
		);
		return root ? path.relative(root, file) : file;
	};

	async function readLocal(file: string): Promise<string | null> {
		if (!withinRoots(file)) return null;
		try {
			return await fs.readFile(file, "utf8");
		} catch {
			return null;
		}
	}

	async function fetchLocalhost(url: URL): Promise<string | null> {
		if (!LOCAL_HOSTS.has(url.hostname)) return null;
		try {
			const response = await fetchImpl(url, {
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			});
			return response.ok ? await response.text() : null;
		} catch {
			return null;
		}
	}

	async function loadMap(location: string): Promise<LoadedMap | null> {
		const isUrl = /^https?:\/\//.test(location);
		const code = isUrl
			? await fetchLocalhost(new URL(location))
			: await readLocal(location);
		if (code === null) return null;

		const reference = [...code.matchAll(SOURCE_MAPPING_URL)].pop()?.[1];
		let raw: string | null = null;
		let base = isUrl ? location : path.dirname(location);
		if (reference?.startsWith("data:")) {
			raw = decodeDataUri(reference);
		} else if (reference) {
			if (isUrl) {
				const mapUrl = new URL(reference, location);
				raw = await fetchLocalhost(mapUrl);
				base = mapUrl.href;
			} else {
				const mapPath = path.resolve(path.dirname(location), reference);
				raw = await readLocal(mapPath);
				base = path.dirname(mapPath);
			}
		} else if (!isUrl) {
			raw = await readLocal(`${location}.map`);
		}
		if (!raw) return null;
		try {
			return { consumer: new SourceMapConsumer(JSON.parse(raw)), base };
		} catch {
			return null;
		}
	}

	function mapFor(filename: string): Promise<LoadedMap | null> {
		const location = /^https?:\/\//.test(filename)
			? filename
			: path.resolve(filename.replace(/^file:\/\//, "").replace(/[?#].*$/, ""));
		let entry = cache.get(location);
		if (!entry) {
			entry = loadMap(location);
			cache.set(location, entry);
		}
		return entry;
	}

	function resolveSource(source: string, base: string): string {
		if (source.startsWith("file://")) return source.slice(7);
		if (/^https?:\/\//.test(base)) {
			const url = new URL(source, base);
			// Vite serves files outside its root as /@fs/<absolute path>.
			return url.pathname.startsWith("/@fs/")
				? decodeURIComponent(url.pathname.slice(4))
				: source;
		}
		return path.isAbsolute(source) ? source : path.resolve(base, source);
	}

	async function symbolicateFrame(
		frame: IncomingFrame,
	): Promise<IncomingFrame> {
		if (!frame.lineno || !frame.colno) return frame;
		const loaded = await mapFor(frame.filename);
		if (!loaded) return frame;
		const { consumer, base } = loaded;
		let original = consumer.originalPositionFor({
			line: frame.lineno,
			column: frame.colno - 1,
		});
		if (!original.source) {
			original = consumer.originalPositionFor({
				line: frame.lineno,
				column: frame.colno - 1,
				bias: SourceMapConsumer.LEAST_UPPER_BOUND,
			});
		}
		if (!original.source || original.line == null) return frame;

		const content = consumer.sourceContentFor(original.source, true);
		const functionName =
			(content &&
				enclosingFunctionName(content, original.line, original.column ?? 0)) ||
			frame.function;
		const source = resolveSource(original.source, base);
		return {
			filename: displayPath(source),
			function: functionName,
			lineno: original.line,
			colno: (original.column ?? 0) + 1,
			in_app: !source.includes("node_modules"),
			raw: `${frame.function} (${frame.filename}:${frame.lineno}:${frame.colno})`,
		};
	}

	return {
		async symbolicate(event) {
			const frames = event.exception?.stacktrace?.frames;
			if (!event.exception || !frames?.length) return event;
			const resolved = await Promise.all(frames.map(symbolicateFrame));
			return {
				...event,
				exception: { ...event.exception, stacktrace: { frames: resolved } },
			};
		},
	};
}

function decodeDataUri(uri: string): string | null {
	const comma = uri.indexOf(",");
	if (comma === -1) return null;
	const meta = uri.slice(5, comma);
	const data = uri.slice(comma + 1);
	try {
		return meta.endsWith(";base64")
			? Buffer.from(data, "base64").toString("utf8")
			: decodeURIComponent(data);
	} catch {
		return null;
	}
}

/**
 * Name of the nearest named function enclosing a position in source code.
 * A lightweight scan, not a parser: it walks outward through unmatched `{`
 * and reads the signature in front of each, skipping control-flow blocks and
 * anonymous callbacks so the result is the function a person would name.
 */
export function enclosingFunctionName(
	content: string,
	line: number,
	column: number,
): string | null {
	const lines = content.split("\n");
	let offset = column;
	for (let index = 0; index < line - 1 && index < lines.length; index += 1) {
		offset += (lines[index]?.length ?? 0) + 1;
	}

	let cursor = Math.min(offset, content.length) - 1;
	for (let guard = 0; guard < 100 && cursor >= 0; guard += 1) {
		const brace = unmatchedOpenBrace(content, cursor);
		if (brace < 0) return null;
		const name = functionNameBefore(content, brace);
		if (name) return name;
		cursor = brace - 1;
	}
	return null;
}

function unmatchedOpenBrace(content: string, from: number): number {
	let depth = 0;
	for (let index = from; index >= 0; index -= 1) {
		const char = content[index];
		if (char === "}") depth += 1;
		else if (char === "{") {
			if (depth === 0) return index;
			depth -= 1;
		}
	}
	return -1;
}

function matchingOpenParen(content: string, close: number): number {
	let depth = 0;
	for (let index = close; index >= 0; index -= 1) {
		const char = content[index];
		if (char === ")") depth += 1;
		else if (char === "(") {
			depth -= 1;
			if (depth === 0) return index;
		}
	}
	return -1;
}

/** Drops a return type annotation, e.g. `): { replies: R[] } | null`. */
function stripReturnType(head: string): string {
	if (head.endsWith(")")) return head;
	for (let index = head.length - 1; index >= 0; index -= 1) {
		if (head[index] !== ")") continue;
		const rest = head.slice(index + 1);
		const balanced =
			rest.split("{").length === rest.split("}").length &&
			rest.split("(").length === rest.split(")").length;
		if (/^\s*:/.test(rest) && !rest.includes(";") && balanced) {
			return head.slice(0, index + 1);
		}
	}
	return head;
}

function functionNameBefore(content: string, brace: number): string | null {
	// Wide enough for components whose inline props type spans dozens of lines.
	let head = content.slice(Math.max(0, brace - 5000), brace).trimEnd();
	const isArrow = head.endsWith("=>");
	if (isArrow) head = head.slice(0, -2).trimEnd();
	head = stripReturnType(head);
	if (!head.endsWith(")")) {
		// `x => {` with a bare parameter: an anonymous arrow.
		return null;
	}
	const open = matchingOpenParen(head, head.length - 1);
	if (open < 0) return null;
	const before = head
		.slice(0, open)
		.trimEnd()
		.replace(/<[^<>]*>$/, "");
	if (CONTROL_KEYWORDS.test(before)) return null;

	if (isArrow) {
		const assigned =
			/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?$/.exec(
				before,
			) ?? /([A-Za-z_$][\w$]*)\s*[:=]\s*(?:async\s*)?$/.exec(before);
		return assigned?.[1] ?? null;
	}
	const declared = /function\s*\*?\s*([A-Za-z_$][\w$]*)$/.exec(before);
	if (declared?.[1]) return declared[1];
	const method =
		/(?:^|[\s;{},])(?:(?:async|static|get|set|public|private|protected)\s+)*([A-Za-z_$][\w$]*)$/.exec(
			before,
		);
	const name = method?.[1];
	return name && !NOT_NAMES.has(name) && !/^\s*function\s*$/.test(before)
		? name
		: null;
}
