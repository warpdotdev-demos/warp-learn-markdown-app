import { createHash } from "node:crypto";
import type { IncomingEvent, IncomingFrame } from "./eventSchema.js";

const SIGNIFICANT_FRAMES = 3;

/**
 * Basename without query strings or bundler content hashes, so
 * `assets/index-DWbuZQEI.js` groups with the same code from the next build.
 */
export function normalizeFilename(filename: string): string {
	const base = filename.split(/[\\/]/).pop() ?? filename;
	return base
		.replace(/[?#].*$/, "")
		.replace(/-[A-Za-z0-9_]{8}(\.[cm]?js)$/, "$1");
}

/** Strips values that vary between occurrences of the same problem. */
export function normalizeMessage(message: string): string {
	return message
		.replace(/(?:[A-Za-z]:)?(?:[\\/][^\s'"`:\\/]+){2,}/g, "<path>")
		.replace(
			/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
			"<uuid>",
		)
		.replace(/\b0x[0-9a-f]+\b/gi, "<hex>")
		.replace(/\d+/g, "<n>")
		.slice(0, 300);
}

export function significantFrames(event: IncomingEvent): IncomingFrame[] {
	const frames = event.exception?.stacktrace?.frames ?? [];
	const inApp = frames.filter((frame) => frame.in_app);
	return (inApp.length > 0 ? inApp : frames).slice(0, SIGNIFICANT_FRAMES);
}

/** Groups events into issues: exception type plus the top in-app frames, ignoring line numbers. */
export function computeFingerprint(event: IncomingEvent): string {
	return createHash("sha256")
		.update(fingerprintParts(event).join("\n"))
		.digest("hex")
		.slice(0, 16);
}

function fingerprintParts(event: IncomingEvent): string[] {
	if (event.fingerprint && event.fingerprint.length > 0) {
		return ["custom", ...event.fingerprint];
	}
	if (event.exception) {
		const frames = significantFrames(event);
		if (frames.length > 0) {
			return [
				"exception",
				event.exception.type,
				...frames.map(
					(frame) => `${normalizeFilename(frame.filename)}:${frame.function}`,
				),
			];
		}
		return [
			"exception",
			event.exception.type,
			normalizeMessage(event.exception.value),
		];
	}
	return ["message", normalizeMessage(event.message ?? "")];
}

export function issueTitle(event: IncomingEvent): string {
	const title = event.exception
		? `${event.exception.type}: ${event.exception.value}`
		: (event.message ?? "Unknown event");
	return (title.split("\n")[0] ?? title).slice(0, 200);
}

export function issueCulprit(event: IncomingEvent): string | null {
	const frame = significantFrames(event)[0];
	return frame
		? `${frame.function} (${normalizeFilename(frame.filename)})`
		: null;
}
