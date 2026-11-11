import type { CaptureOptions, ReportedEvent } from "@marky/error-reporter";
import {
	initRendererReporter,
	type RendererReporter,
} from "@marky/error-reporter/renderer";

declare global {
	interface Window {
		/** Set by preload only when the main process is reporting errors. */
		markyErrorReporter?: { send: (event: ReportedEvent) => void };
	}
}

let reporter: RendererReporter | null = null;

/** Hooks window errors and unhandled rejections. A no-op unless reporting is on. */
export function initErrorReporting() {
	const bridge = window.markyErrorReporter;
	if (!bridge || reporter) return;
	reporter = initRendererReporter({ send: (event) => bridge.send(event) });
}

export function captureException(error: unknown, options?: CaptureOptions) {
	reporter?.client.captureException(error, options);
}

export function addBreadcrumb(category: string, message: string) {
	reporter?.client.addBreadcrumb({ category, message });
}
