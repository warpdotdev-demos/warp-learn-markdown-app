import { parseStack } from "./stack.js";
import type {
	Breadcrumb,
	ExceptionInfo,
	Level,
	ReportedEvent,
} from "./types.js";

export type Transport = (events: ReportedEvent[]) => void;

export type ClientOptions = {
	platform: string;
	transport: Transport;
	release?: string;
	environment?: string;
	maxBreadcrumbs?: number;
	/** Return null to drop the event. */
	beforeSend?: (event: ReportedEvent) => ReportedEvent | null;
	enabled?: boolean;
};

export type CaptureOptions = {
	level?: Level;
	handled?: boolean;
	tags?: Record<string, string>;
	fingerprint?: string[];
};

const DEFAULT_MAX_BREADCRUMBS = 50;

export class ReporterClient {
	readonly options: ClientOptions;
	private breadcrumbs: Breadcrumb[] = [];
	private tags: Record<string, string> = {};

	constructor(options: ClientOptions) {
		this.options = options;
	}

	captureException(error: unknown, options: CaptureOptions = {}): string {
		return this.send({
			...this.baseEvent(options.level ?? "error", options),
			exception: exceptionFromError(error),
		});
	}

	captureMessage(
		message: string,
		level: Level = "info",
		options: CaptureOptions = {},
	): string {
		return this.send({ ...this.baseEvent(level, options), message });
	}

	addBreadcrumb(
		breadcrumb: Omit<Breadcrumb, "timestamp"> & { timestamp?: string },
	) {
		this.breadcrumbs.push({
			...breadcrumb,
			timestamp: breadcrumb.timestamp ?? new Date().toISOString(),
		});
		const max = this.options.maxBreadcrumbs ?? DEFAULT_MAX_BREADCRUMBS;
		if (this.breadcrumbs.length > max) {
			this.breadcrumbs.splice(0, this.breadcrumbs.length - max);
		}
	}

	setTag(key: string, value: string) {
		this.tags[key] = value;
	}

	/** Sends an event built elsewhere (for example in a renderer), filling in missing context. */
	forward(event: ReportedEvent): string {
		return this.send({
			...event,
			release: event.release ?? this.options.release,
			environment: event.environment ?? this.options.environment,
		});
	}

	private baseEvent(level: Level, options: CaptureOptions): ReportedEvent {
		const tags = { ...this.tags, ...options.tags };
		return {
			event_id: eventId(),
			timestamp: new Date().toISOString(),
			level,
			platform: this.options.platform,
			handled: options.handled ?? true,
			release: this.options.release,
			environment: this.options.environment,
			tags: Object.keys(tags).length > 0 ? tags : undefined,
			breadcrumbs:
				this.breadcrumbs.length > 0 ? [...this.breadcrumbs] : undefined,
			fingerprint: options.fingerprint,
		};
	}

	private send(event: ReportedEvent): string {
		if (this.options.enabled === false) return event.event_id;
		const final = this.options.beforeSend
			? this.options.beforeSend(event)
			: event;
		if (final) {
			try {
				this.options.transport([final]);
			} catch {
				// Reporting must never throw into the caller.
			}
		}
		return event.event_id;
	}
}

export function exceptionFromError(error: unknown): ExceptionInfo {
	if (error instanceof Error) {
		const frames = parseStack(error.stack);
		return {
			type: error.name || error.constructor?.name || "Error",
			value: error.message,
			stacktrace: frames.length > 0 ? { frames } : undefined,
		};
	}
	return { type: "Error", value: describeNonError(error) };
}

function describeNonError(value: unknown): string {
	if (typeof value === "string") return value;
	try {
		return `Non-Error thrown: ${JSON.stringify(value)}`;
	} catch {
		return `Non-Error thrown: ${String(value)}`;
	}
}

function eventId(): string {
	const cryptoApi = globalThis.crypto;
	if (cryptoApi?.randomUUID) return cryptoApi.randomUUID().replace(/-/g, "");
	let id = "";
	for (let index = 0; index < 32; index += 1) {
		id += Math.floor(Math.random() * 16).toString(16);
	}
	return id;
}
