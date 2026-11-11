import { type ClientOptions, ReporterClient } from "./client.js";
import type { ReportedEvent } from "./types.js";

export { ReporterClient } from "./client.js";
export { RENDERER_EVENT_CHANNEL } from "./types.js";

// Benign browser noise that never indicates an app bug.
const IGNORED_MESSAGES = [/ResizeObserver loop/];

type EventTargetLike = Pick<
	EventTarget,
	"addEventListener" | "removeEventListener"
>;

export type RendererReporterOptions = Omit<
	ClientOptions,
	"transport" | "platform"
> & {
	/** Hands an event to the main process, e.g. `ipcRenderer.send(RENDERER_EVENT_CHANNEL, event)`. */
	send: (event: ReportedEvent) => void;
	platform?: string;
	target?: EventTargetLike;
};

export type RendererReporter = {
	client: ReporterClient;
	uninstall: () => void;
};

export function initRendererReporter(
	options: RendererReporterOptions,
): RendererReporter {
	const client = new ReporterClient({
		...options,
		platform: options.platform ?? "electron-renderer",
		transport: (events) => {
			for (const event of events) options.send(event);
		},
	});
	const target = options.target ?? globalThis;

	const onError = (event: Event) => {
		const { error, message } = event as ErrorEvent;
		const text = error instanceof Error ? error.message : String(message ?? "");
		if (IGNORED_MESSAGES.some((pattern) => pattern.test(text))) return;
		client.captureException(error ?? new Error(text), {
			handled: false,
			tags: { mechanism: "onerror" },
		});
	};
	const onRejection = (event: Event) => {
		client.captureException((event as PromiseRejectionEvent).reason, {
			handled: false,
			tags: { mechanism: "unhandledrejection" },
		});
	};

	if (options.enabled !== false) {
		target.addEventListener("error", onError);
		target.addEventListener("unhandledrejection", onRejection);
	}
	return {
		client,
		uninstall() {
			target.removeEventListener("error", onError);
			target.removeEventListener("unhandledrejection", onRejection);
		},
	};
}
