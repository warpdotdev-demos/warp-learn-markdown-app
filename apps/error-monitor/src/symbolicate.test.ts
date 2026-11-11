import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SourceMapGenerator } from "source-map-js";
import { describe, expect, it } from "vitest";
import type { IncomingEvent } from "./eventSchema.js";
import { createSymbolicator, enclosingFunctionName } from "./symbolicate.js";

const GUTTER_SOURCE = `export function ReviewCommentGutter({ comments }: Props) {
	const topAt = (pos: number) => {
		return { top: pos };
	};

	const byLine = new Map<number, Badge>();
	for (const comment of comments) {
		const { top } = topAt(comment.from);
		const count = 1 + comment.attrs.replies!.length;
		byLine.set(top, { count });
	}
	return byLine;
}
`;

describe("enclosingFunctionName", () => {
	it("skips loops and sibling arrows to find the component", () => {
		expect(enclosingFunctionName(GUTTER_SOURCE, 9, 20)).toBe(
			"ReviewCommentGutter",
		);
	});

	it("names arrow functions assigned to a const", () => {
		expect(enclosingFunctionName(GUTTER_SOURCE, 3, 4)).toBe("topAt");
	});

	it("finds a component through JSX and a long inline props type", () => {
		const props = Array.from(
			{ length: 40 },
			(_, index) =>
				`\t/** Prop ${index}. */\n\tprop${index}?: (value: string) => void;`,
		).join("\n");
		const source = `export function ReviewCommentPopover({
	editor,
}: {
	editor: Editor;
${props}
}) {
	return (
		<div>
			{replies.map((reply) => (
				<time dateTime={new Date(reply.createdAt).toISOString()} />
			))}
		</div>
	);
}`;
		const lines = source.split("\n");
		const line = lines.findIndex((text) => text.includes("toISOString")) + 1;
		const column = lines[line - 1]?.indexOf(".toISOString") ?? 0;
		expect(enclosingFunctionName(source, line, column)).toBe(
			"ReviewCommentPopover",
		);
	});

	it("handles multi-line destructured signatures with return types", () => {
		const source = `export function parseReviewMetadata(
	value: string | undefined,
): { replies: string[] } | null {
	const parsed = JSON.parse(value ?? "");
	return parsed;
}`;
		expect(enclosingFunctionName(source, 4, 16)).toBe("parseReviewMetadata");
	});
});

function bundleWithMap(root: string) {
	const dist = path.join(root, "packages", "ui", "dist");
	fs.mkdirSync(dist, { recursive: true });
	const bundlePath = path.join(dist, "index.js");
	fs.writeFileSync(
		bundlePath,
		"function Xe(e){for(const t of e)1+t.attrs.replies.length}\n//# sourceMappingURL=index.js.map\n",
	);
	const generator = new SourceMapGenerator({ file: "index.js" });
	generator.addMapping({
		generated: { line: 1, column: 33 },
		original: { line: 9, column: 33 },
		source: "../src/editor/ReviewCommentGutter.tsx",
	});
	generator.setSourceContent(
		"../src/editor/ReviewCommentGutter.tsx",
		GUTTER_SOURCE,
	);
	fs.writeFileSync(path.join(dist, "index.js.map"), generator.toString());
	return bundlePath;
}

function eventAt(filename: string, colno: number): IncomingEvent {
	return {
		level: "error",
		platform: "electron-renderer",
		handled: false,
		exception: {
			type: "TypeError",
			value: "Cannot read properties of null (reading 'length')",
			stacktrace: {
				frames: [{ filename, function: "Xe", lineno: 1, colno, in_app: true }],
			},
		},
	};
}

describe("createSymbolicator", () => {
	it("resolves a bundled frame to source file, line, and function", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "symbolicate-"));
		const bundlePath = bundleWithMap(root);
		const symbolicator = createSymbolicator({ roots: [root] });

		const result = await symbolicator.symbolicate(
			eventAt(`file://${bundlePath}`, 34),
		);
		expect(result.exception?.stacktrace?.frames[0]).toEqual({
			filename: path.join(
				"packages",
				"ui",
				"src",
				"editor",
				"ReviewCommentGutter.tsx",
			),
			function: "ReviewCommentGutter",
			lineno: 9,
			colno: 34,
			in_app: true,
			raw: `Xe (file://${bundlePath}:1:34)`,
		});
	});

	it("leaves frames alone when the file is outside the source roots", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "symbolicate-"));
		const bundlePath = bundleWithMap(root);
		const symbolicator = createSymbolicator({
			roots: [path.join(root, "elsewhere")],
		});
		const event = eventAt(bundlePath, 34);
		expect(await symbolicator.symbolicate(event)).toEqual(event);
	});

	it("only fetches dev-server modules from localhost", async () => {
		const requested: string[] = [];
		const symbolicator = createSymbolicator({
			roots: [],
			fetch: async (input) => {
				requested.push(String(input));
				return new Response("", { status: 404 });
			},
		});
		await symbolicator.symbolicate(eventAt("https://example.com/app.js", 1));
		await symbolicator.symbolicate(
			eventAt("http://localhost:1420/@fs/repo/packages/ui/dist/index.js", 1),
		);
		expect(requested).toEqual([
			"http://localhost:1420/@fs/repo/packages/ui/dist/index.js",
		]);
	});
});
