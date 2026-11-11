import { all, type Db, get, run } from "../db.js";
import type { AlertRow, DeliveryRow, EndpointRow } from "../types.js";
import { signPayload } from "./sign.js";

/** Delay before each retry; one initial attempt plus these four. */
export const RETRY_DELAYS_MS = [5_000, 30_000, 120_000, 600_000];
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
const REQUEST_TIMEOUT_MS = 10_000;
const USER_AGENT = "marky-error-monitor/0.1";

export function enqueueDeliveries(
	db: Db,
	alert: Pick<AlertRow, "id" | "project_id">,
	now: number,
	onlyEndpointId?: string,
): number {
	const endpoints = onlyEndpointId
		? all<EndpointRow>(
				db,
				"SELECT * FROM webhook_endpoints WHERE id = ?",
				onlyEndpointId,
			)
		: all<EndpointRow>(
				db,
				"SELECT * FROM webhook_endpoints WHERE project_id = ? AND enabled = 1",
				alert.project_id,
			);
	for (const endpoint of endpoints) {
		run(
			db,
			"INSERT INTO webhook_deliveries (alert_id, endpoint_id, status, attempts, next_attempt_at, created_at, updated_at) VALUES (?, ?, 'pending', 0, ?, ?, ?)",
			alert.id,
			endpoint.id,
			now,
			now,
			now,
		);
	}
	return endpoints.length;
}

export function deliveryHeaders(
	endpoint: Pick<EndpointRow, "auth_mode" | "secret">,
	alertId: string,
	body: string,
	nowMs: number,
): Record<string, string> {
	const timestamp = Math.floor(nowMs / 1000);
	const headers: Record<string, string> = {
		"content-type": "application/json",
		"user-agent": USER_AGENT,
		// Stable per alert, so a receiver that saw an earlier attempt can dedupe retries.
		"webhook-id": alertId,
		"webhook-timestamp": String(timestamp),
	};
	if (endpoint.auth_mode === "signature" && endpoint.secret) {
		headers["webhook-signature"] = signPayload(
			endpoint.secret,
			alertId,
			timestamp,
			body,
		);
	} else if (endpoint.auth_mode === "token" && endpoint.secret) {
		headers.authorization = `Bearer ${endpoint.secret}`;
	}
	return headers;
}

type DeliveryJob = DeliveryRow &
	Pick<EndpointRow, "url" | "auth_mode" | "secret"> & { payload: string };

export type DeliveryOptions = {
	fetch?: typeof fetch;
	now?: () => number;
};

export async function attemptDelivery(
	db: Db,
	deliveryId: number,
	options: DeliveryOptions = {},
): Promise<DeliveryRow | undefined> {
	const now = options.now ?? Date.now;
	const fetchImpl = options.fetch ?? globalThis.fetch;
	const job = get<DeliveryJob>(
		db,
		`SELECT d.*, e.url, e.auth_mode, e.secret, a.payload
		 FROM webhook_deliveries d
		 JOIN webhook_endpoints e ON e.id = d.endpoint_id
		 JOIN alerts a ON a.id = d.alert_id
		 WHERE d.id = ?`,
		deliveryId,
	);
	if (!job || job.status !== "pending") return job;

	const attempts = job.attempts + 1;
	let responseStatus: number | null = null;
	let error: string | null = null;
	try {
		const response = await fetchImpl(job.url, {
			method: "POST",
			headers: deliveryHeaders(job, job.alert_id, job.payload, now()),
			body: job.payload,
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
		responseStatus = response.status;
		if (!response.ok) {
			const text = await response.text().catch(() => "");
			error = `HTTP ${response.status}${text ? `: ${text.slice(0, 300)}` : ""}`;
		}
	} catch (caught) {
		error = caught instanceof Error ? caught.message : String(caught);
	}

	const finishedAt = now();
	const succeeded = error === null;
	const exhausted = attempts >= MAX_ATTEMPTS;
	const status = succeeded ? "success" : exhausted ? "failed" : "pending";
	const retryDelay = RETRY_DELAYS_MS[attempts - 1];
	const nextAttemptAt =
		status === "pending" && retryDelay !== undefined
			? finishedAt + retryDelay
			: null;
	run(
		db,
		"UPDATE webhook_deliveries SET status = ?, attempts = ?, next_attempt_at = ?, response_status = ?, error = ?, updated_at = ? WHERE id = ?",
		status,
		attempts,
		nextAttemptAt,
		responseStatus,
		error,
		finishedAt,
		deliveryId,
	);
	return get<DeliveryRow>(
		db,
		"SELECT * FROM webhook_deliveries WHERE id = ?",
		deliveryId,
	);
}

export type DeliveryWorker = {
	/** Attempts every due delivery once. */
	tick: () => Promise<void>;
	stop: () => void;
};

export function startDeliveryWorker(
	db: Db,
	options: DeliveryOptions & { intervalMs?: number; autoStart?: boolean } = {},
): DeliveryWorker {
	const now = options.now ?? Date.now;
	const inflight = new Set<number>();

	async function tick() {
		const due = all<{ id: number }>(
			db,
			"SELECT id FROM webhook_deliveries WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY next_attempt_at LIMIT 20",
			now(),
		).filter((row) => !inflight.has(row.id));
		await Promise.all(
			due.map(async ({ id }) => {
				inflight.add(id);
				try {
					await attemptDelivery(db, id, options);
				} catch (error) {
					console.error(`Webhook delivery ${id} failed unexpectedly:`, error);
				} finally {
					inflight.delete(id);
				}
			}),
		);
	}

	const timer =
		options.autoStart === false
			? null
			: setInterval(() => void tick(), options.intervalMs ?? 1000);
	return {
		tick,
		stop() {
			if (timer) clearInterval(timer);
		},
	};
}
