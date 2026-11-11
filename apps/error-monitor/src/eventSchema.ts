import { z } from "zod";

const level = z.enum(["fatal", "error", "warning", "info"]);

const frame = z.object({
	filename: z.string().max(1000),
	function: z.string().max(500),
	lineno: z.number().int().optional(),
	colno: z.number().int().optional(),
	in_app: z.boolean().default(true),
	/** The bundled location, kept when a frame is resolved through a source map. */
	raw: z.string().max(1000).optional(),
});

const exception = z.object({
	type: z.string().min(1).max(200),
	value: z.string().max(5000),
	stacktrace: z.object({ frames: z.array(frame).max(100) }).optional(),
});

const breadcrumb = z.object({
	timestamp: z.string().max(64),
	message: z.string().max(1000),
	category: z.string().max(100).optional(),
	level: level.optional(),
	data: z.record(z.string(), z.unknown()).optional(),
});

export const eventSchema = z
	.object({
		event_id: z
			.string()
			.regex(/^[A-Za-z0-9_-]{8,64}$/)
			.optional(),
		timestamp: z.string().max(64).optional(),
		level: level.default("error"),
		platform: z.string().max(50).default("unknown"),
		handled: z.boolean().default(true),
		message: z.string().max(5000).optional(),
		exception: exception.optional(),
		release: z.string().max(200).optional(),
		environment: z.string().max(100).optional(),
		tags: z.record(z.string().max(100), z.string().max(500)).optional(),
		breadcrumbs: z.array(breadcrumb).max(100).optional(),
		fingerprint: z.array(z.string().max(500)).max(10).optional(),
	})
	.refine((event) => event.message || event.exception, {
		message: "An event needs a message or an exception",
	});

export const ingestBodySchema = z.union([
	z.object({ events: z.array(eventSchema).min(1).max(100) }),
	eventSchema,
]);

export type IncomingEvent = z.infer<typeof eventSchema>;
export type IncomingFrame = z.infer<typeof frame>;
