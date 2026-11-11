import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ReporterClient } from "./client.js";
import { parseDsn } from "./dsn.js";
import { createHttpTransport, forwardRendererEvents } from "./node.js";
import { initRendererReporter } from "./renderer.js";
import { parseStack } from "./stack.js";
import type { ReportedEvent } from "./types.js";

const DSN = "http://key123@localhost:4747/marky";

describe("parseDsn", () => {
	it("derives the ingest endpoint and key", () => {
		expect(parseDsn(DSN)).toEqual({
			key: "key123",
			projectId: "marky",
			endpoint: "http://localhost:4747/api/projects/marky/events",
		});
	});

	it("rejects a DSN without a key", () => {
		expect(() => parseDsn("http://localhost:4747/marky")).toThrow(
			/Invalid DSN/,
		);
	});
});

describe("parseStack", () => {
	it("parses V8 frames and marks library frames as not in-app", () => {
		const frames = parseStack(
			[
				"TypeError: Cannot read properties of null (reading 'length')",
				"    at ReviewCommentGutter (file:///app/out/renderer/assets/index-DWbuZQEI.js:12:34)",
				"    at async loadNote (/app/src/store/actions.ts:5:6)",
				"    at renderWithHooks (/app/node_modules/react-dom/cjs/react-dom.js:1:2)",
				"    at node:internal/process/task_queues:95:5",
			].join("\n"),
		);
		expect(frames).toEqual([
			{
				filename: "/app/out/renderer/assets/index-DWbuZQEI.js",
				function: "ReviewCommentGutter",
				lineno: 12,
				colno: 34,
				in_app: true,
			},
			{
				filename: "/app/src/store/actions.ts",
				function: "loadNote",
				lineno: 5,
				colno: 6,
				in_app: true,
			},
			{
				filename: "/app/node_modules/react-dom/cjs/react-dom.js",
				function: "renderWithHooks",
				lineno: 1,
				colno: 2,
				in_app: false,
			},
			{
				filename: "node:internal/process/task_queues",
				function: "<anonymous>",
				lineno: 95,
				colno: 5,
				in_app: false,
			},
		]);
	});
});

describe("ReporterClient", () => {
	it("captures exceptions with context and breadcrumbs", () => {
		const sent: ReportedEvent[] = [];
		const client = new ReporterClient({
			platform: "node",
			release: "marky@1.0.0",
			transport: (events) => sent.push(...events),
		});
		client.setTag("os", "darwin");
		client.addBreadcrumb({ message: "opened note", category: "navigation" });
		client.captureException(new RangeError("boom"), { handled: false });

		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({
			level: "error",
			handled: false,
			platform: "node",
			release: "marky@1.0.0",
			tags: { os: "darwin" },
			exception: { type: "RangeError", value: "boom" },
			breadcrumbs: [{ message: "opened note", category: "navigation" }],
		});
		expect(sent[0]?.exception?.stacktrace?.frames.length).toBeGreaterThan(0);
	});

	it("never throws when the transport fails", () => {
		const client = new ReporterClient({
			platform: "node",
			transport: () => {
				throw new Error("offline");
			},
		});
		expect(() => client.captureMessage("hello")).not.toThrow();
	});

	it("describes non-Error throws", () => {
		const sent: ReportedEvent[] = [];
		const client = new ReporterClient({
			platform: "node",
			transport: (events) => sent.push(...events),
		});
		client.captureException({ code: 7 });
		expect(sent[0]?.exception).toEqual({
			type: "Error",
			value: 'Non-Error thrown: {"code":7}',
		});
	});
});

describe("createHttpTransport", () => {
	it("batches events with the DSN key", async () => {
		const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
		const http = createHttpTransport({ dsn: DSN, fetch: fetchMock });
		const client = new ReporterClient({
			platform: "node",
			transport: http.transport,
		});
		client.captureMessage("one");
		client.captureMessage("two");

		await expect(http.flush()).resolves.toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as unknown as [
			string,
			RequestInit,
		];
		expect(url).toBe("http://localhost:4747/api/projects/marky/events");
		expect(new Headers(init.headers).get("x-monitor-key")).toBe("key123");
		expect(JSON.parse(String(init.body)).events).toHaveLength(2);
		http.close();
	});

	it("persists undelivered events and reloads them", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reporter-"));
		const queuePath = path.join(dir, "queue.json");
		const offline = createHttpTransport({
			dsn: DSN,
			queuePath,
			fetch: async () => {
				throw new Error("ECONNREFUSED");
			},
		});
		new ReporterClient({
			platform: "node",
			transport: offline.transport,
		}).captureMessage("kept");
		await expect(offline.flush()).resolves.toBe(false);
		offline.close();
		expect(fs.existsSync(queuePath)).toBe(true);

		const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
		const online = createHttpTransport({
			dsn: DSN,
			queuePath,
			fetch: fetchMock,
		});
		expect(online.pending()).toBe(1);
		await expect(online.flush()).resolves.toBe(true);
		expect(fs.existsSync(queuePath)).toBe(false);
		online.close();
	});

	it("drops batches the monitor rejects instead of retrying forever", async () => {
		const http = createHttpTransport({
			dsn: DSN,
			fetch: async () => new Response(null, { status: 401 }),
		});
		new ReporterClient({
			platform: "node",
			transport: http.transport,
		}).captureMessage("bad key");
		await expect(http.flush()).resolves.toBe(true);
		expect(http.pending()).toBe(0);
		http.close();
	});
});

describe("renderer forwarding", () => {
	it("reports window errors through the send bridge to the main client", () => {
		const target = new EventTarget();
		const listeners = new Map<
			string,
			(event: unknown, payload: unknown) => void
		>();
		const forwarded: ReportedEvent[] = [];
		const mainClient = new ReporterClient({
			platform: "electron-main",
			release: "marky@2.0.0",
			transport: (events) => forwarded.push(...events),
		});
		forwardRendererEvents(
			{ on: (channel, listener) => listeners.set(channel, listener) },
			mainClient,
		);

		const renderer = initRendererReporter({
			target,
			send: (event) => listeners.get("marky-error-reporter:event")?.({}, event),
		});
		const error = new TypeError("render failed");
		const event = new Event("error") as Event & {
			error: Error;
			message: string;
		};
		event.error = error;
		event.message = error.message;
		target.dispatchEvent(event);

		expect(forwarded).toHaveLength(1);
		expect(forwarded[0]).toMatchObject({
			platform: "electron-renderer",
			release: "marky@2.0.0",
			handled: false,
			exception: { type: "TypeError", value: "render failed" },
		});
		renderer.uninstall();
	});
});
