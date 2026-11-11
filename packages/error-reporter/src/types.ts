export type Level = "fatal" | "error" | "warning" | "info";

/** One stack frame. Frames are ordered innermost first, like a V8 stack string. */
export type StackFrame = {
	filename: string;
	function: string;
	lineno?: number;
	colno?: number;
	in_app: boolean;
};

export type ExceptionInfo = {
	type: string;
	value: string;
	stacktrace?: { frames: StackFrame[] };
};

export type Breadcrumb = {
	timestamp: string;
	message: string;
	category?: string;
	level?: Level;
	data?: Record<string, unknown>;
};

/** The wire format accepted by the monitor's ingest API. */
export type ReportedEvent = {
	event_id: string;
	timestamp: string;
	level: Level;
	platform: string;
	handled: boolean;
	message?: string;
	exception?: ExceptionInfo;
	release?: string;
	environment?: string;
	tags?: Record<string, string>;
	breadcrumbs?: Breadcrumb[];
	fingerprint?: string[];
};

/** IPC channel the renderer entry point uses to hand events to the main process. */
export const RENDERER_EVENT_CHANNEL = "marky-error-reporter:event";
