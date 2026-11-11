import type { StackFrame } from "./types.js";

// `    at fn (file:1:2)`, `    at file:1:2`, `    at async fn (file:1:2)`
const V8_FRAME = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/;
const MAX_FRAMES = 50;

export function defaultInApp(filename: string): boolean {
	return !(
		filename.includes("/node_modules/") ||
		filename.startsWith("node:") ||
		filename.startsWith("internal/") ||
		filename === "<anonymous>" ||
		filename === "native"
	);
}

/** Parses a V8 (Node, Chromium, Electron) stack string into frames, innermost first. */
export function parseStack(
	stack: string | undefined,
	inApp: (filename: string) => boolean = defaultInApp,
): StackFrame[] {
	if (!stack) return [];
	const frames: StackFrame[] = [];
	for (const line of stack.split("\n")) {
		const match = V8_FRAME.exec(line);
		if (!match) continue;
		const filename = cleanFilename(match[2] ?? "");
		frames.push({
			filename,
			function: cleanFunction(match[1]),
			lineno: Number(match[3]),
			colno: Number(match[4]),
			in_app: inApp(filename),
		});
		if (frames.length >= MAX_FRAMES) break;
	}
	return frames;
}

function cleanFilename(value: string): string {
	const filename = value.replace(/^file:\/\//, "");
	try {
		return decodeURI(filename);
	} catch {
		return filename;
	}
}

function cleanFunction(value: string | undefined): string {
	if (!value) return "<anonymous>";
	return value.replace(/^async /, "").replace(/^new /, "") || "<anonymous>";
}
