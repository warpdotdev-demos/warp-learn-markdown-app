import fs from "node:fs";
import path from "node:path";
import {
	type ClientOptions,
	ReporterClient,
	type Transport,
} from "./client.js";
import { parseDsn } from "./dsn.js";
import {
	type Level,
	RENDERER_EVENT_CHANNEL,
	type ReportedEvent,
} from "./types.js";

export { ReporterClient } from "./client.js";
export { RENDERER_EVENT_CHANNEL } from "./types.js";

const BATCH_SIZE = 50;
const DEFAULT_MAX_QUEUE = 500;
const DEFAULT_BATCH_DELAY_MS = 250;
const MAX_RETRY_DELAY_MS = 60_000;

export type HttpTransportOptions = {
	dsn: string;
	/** Where undelivered events are kept across restarts. Omit to keep them in memory only. */
	queuePath?: string;
	fetch?: typeof fetch;
	batchDelayMs?: number;
	maxQueue?: number;
	onError?: (error: unknown) => void;
};

export type HttpTransport = {
	transport: Transport;
	/** Sends everything queued. Resolves false if the monitor could not be reached. */
	flush: () => Promise<boolean>;
	pending: () => number;
	close: () => void;
};

export function createHttpTransport(
	options: HttpTransportOptions,
): HttpTransport {
	const dsn = parseDsn(options.dsn);
	const fetchImpl = options.fetch ?? globalThis.fetch;
	const maxQueue = options.maxQueue ?? DEFAULT_MAX_QUEUE;
	const queue: ReportedEvent[] = loadQueue(options.queuePath);
	let timer: ReturnType<typeof setTimeout> | null = null;
	let inflight: Promise<boolean> | null = null;
	let failures = 0;

	function schedule(delayMs: number) {
		if (timer) return;
		timer = setTimeout(() => {
			timer = null;
			void flush();
		}, delayMs);
		timer.unref?.();
	}

	function persist() {
		const queuePath = options.queuePath;
		if (!queuePath) return;
		try {
			if (queue.length === 0) {
				fs.rmSync(queuePath, { force: true });
			} else {
				fs.mkdirSync(path.dirname(queuePath), { recursive: true });
				fs.writeFileSync(queuePath, JSON.stringify(queue));
			}
		} catch (error) {
			options.onError?.(error);
		}
	}

	async function drain(): Promise<boolean> {
		while (queue.length > 0) {
			const batch = queue.slice(0, BATCH_SIZE);
			try {
				const response = await fetchImpl(dsn.endpoint, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						"x-monitor-key": dsn.key,
					},
					body: JSON.stringify({ events: batch }),
				});
				const rejected =
					response.status >= 400 &&
					response.status < 500 &&
					response.status !== 429;
				if (!response.ok && !rejected) {
					throw new Error(`Monitor responded HTTP ${response.status}`);
				}
				// A 4xx will never succeed on retry (bad key or payload), so drop it.
				if (rejected) {
					options.onError?.(
						new Error(`Monitor rejected events: HTTP ${response.status}`),
					);
				}
				queue.splice(0, batch.length);
				failures = 0;
			} catch (error) {
				failures += 1;
				options.onError?.(error);
				persist();
				schedule(Math.min(MAX_RETRY_DELAY_MS, 1000 * 2 ** failures));
				return false;
			}
		}
		persist();
		return true;
	}

	function flush(): Promise<boolean> {
		if (!inflight) {
			inflight = drain().finally(() => {
				inflight = null;
			});
		}
		return inflight;
	}

	return {
		transport(events) {
			queue.push(...events);
			if (queue.length > maxQueue) queue.splice(0, queue.length - maxQueue);
			schedule(options.batchDelayMs ?? DEFAULT_BATCH_DELAY_MS);
		},
		flush,
		pending: () => queue.length,
		close() {
			if (timer) clearTimeout(timer);
			timer = null;
			persist();
		},
	};
}

function loadQueue(queuePath: string | undefined): ReportedEvent[] {
	if (!queuePath) return [];
	try {
		const parsed: unknown = JSON.parse(fs.readFileSync(queuePath, "utf8"));
		return Array.isArray(parsed) ? parsed.filter(isReportedEvent) : [];
	} catch {
		return [];
	}
}

export type NodeReporterOptions = Omit<
	ClientOptions,
	"transport" | "platform"
> & {
	dsn: string;
	platform?: string;
	queuePath?: string;
	fetch?: typeof fetch;
	/** Install process-level uncaughtException/unhandledRejection hooks. Defaults to true. */
	installHandlers?: boolean;
	/** Exit after reporting an uncaught exception, as Node would without a handler. Defaults to true. */
	exitOnUncaught?: boolean;
	onTransportError?: (error: unknown) => void;
};

export type NodeReporter = {
	client: ReporterClient;
	flush: (timeoutMs?: number) => Promise<boolean>;
	close: () => void;
};

export function initNodeReporter(options: NodeReporterOptions): NodeReporter {
	const http = createHttpTransport({
		dsn: options.dsn,
		queuePath: options.queuePath,
		fetch: options.fetch,
		onError: options.onTransportError,
	});
	const client = new ReporterClient({
		...options,
		platform: options.platform ?? "node",
		transport: http.transport,
	});
	const flush = (timeoutMs = 2000) => withTimeout(http.flush(), timeoutMs);
	const uninstall =
		options.installHandlers !== false && options.enabled !== false
			? installProcessHandlers(client, flush, options.exitOnUncaught ?? true)
			: () => {};
	return {
		client,
		flush,
		close() {
			uninstall();
			http.close();
		},
	};
}

function installProcessHandlers(
	client: ReporterClient,
	flush: (timeoutMs?: number) => Promise<boolean>,
	exitOnUncaught: boolean,
) {
	const onUncaught = (error: unknown) => {
		console.error(error);
		client.captureException(error, {
			level: "fatal",
			handled: false,
			tags: { mechanism: "uncaughtException" },
		});
		void flush().finally(() => {
			if (exitOnUncaught) process.exit(1);
		});
	};
	const onRejection = (reason: unknown) => {
		console.error("Unhandled promise rejection:", reason);
		client.captureException(reason, {
			level: "error",
			handled: false,
			tags: { mechanism: "unhandledRejection" },
		});
	};
	process.on("uncaughtException", onUncaught);
	process.on("unhandledRejection", onRejection);
	return () => {
		process.off("uncaughtException", onUncaught);
		process.off("unhandledRejection", onRejection);
	};
}

type IpcMainLike = {
	on: (
		channel: string,
		listener: (event: unknown, payload: unknown) => void,
	) => unknown;
};

/** Accepts events sent by the renderer entry point (over Electron IPC) and reports them. */
export function forwardRendererEvents(
	ipc: IpcMainLike,
	client: ReporterClient,
	channel = RENDERER_EVENT_CHANNEL,
) {
	ipc.on(channel, (_event, payload) => {
		if (isReportedEvent(payload)) client.forward(payload);
	});
}

const LEVELS = new Set<Level>(["fatal", "error", "warning", "info"]);

function isReportedEvent(value: unknown): value is ReportedEvent {
	if (!value || typeof value !== "object") return false;
	const event = value as Partial<ReportedEvent>;
	return (
		typeof event.event_id === "string" &&
		typeof event.timestamp === "string" &&
		typeof event.platform === "string" &&
		typeof event.level === "string" &&
		LEVELS.has(event.level)
	);
}

function withTimeout(promise: Promise<boolean>, timeoutMs: number) {
	return new Promise<boolean>((resolve) => {
		const timer = setTimeout(() => resolve(false), timeoutMs);
		timer.unref?.();
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			() => {
				clearTimeout(timer);
				resolve(false);
			},
		);
	});
}
