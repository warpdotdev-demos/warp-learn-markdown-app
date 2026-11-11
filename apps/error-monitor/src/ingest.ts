import type { MonitorConfig } from "./config.js";
import { type Db, get, run, transaction } from "./db.js";
import type { IncomingEvent } from "./eventSchema.js";
import { computeFingerprint, issueCulprit, issueTitle } from "./fingerprint.js";
import { randomHex, randomId } from "./ids.js";
import { buildAlertPayload, buildTestPayload } from "./payload.js";
import { evaluateRules } from "./rules.js";
import { alertsInLastDay, getIssue, insertAlert } from "./store.js";
import type { AlertRow, AlertType, IssueRow, ProjectRow } from "./types.js";
import { enqueueDeliveries } from "./webhooks/delivery.js";

const EVENTS_KEPT_PER_ISSUE = 100;

export type IngestResult = {
	eventId: string;
	issueId: number;
	duplicate: boolean;
	alert: { id: string; type: AlertType; suppressed: boolean } | null;
};

export type IngestDeps = {
	db: Db;
	config: Pick<MonitorConfig, "publicUrl" | "rules">;
	now: () => number;
};

export function ingestEvent(
	deps: IngestDeps,
	project: ProjectRow,
	incoming: IncomingEvent,
): IngestResult {
	const { db, config } = deps;
	const now = deps.now();
	const event = { ...incoming, event_id: incoming.event_id ?? randomHex(16) };

	return transaction(db, () => {
		const seen = get<{ issue_id: number }>(
			db,
			"SELECT issue_id FROM events WHERE id = ?",
			event.event_id,
		);
		// Reporters retry when a response is lost, so the same event can arrive twice.
		if (seen) {
			return {
				eventId: event.event_id,
				issueId: seen.issue_id,
				duplicate: true,
				alert: null,
			};
		}

		const fingerprint = computeFingerprint(event);
		const existing = get<IssueRow>(
			db,
			"SELECT * FROM issues WHERE project_id = ? AND fingerprint = ?",
			project.id,
			fingerprint,
		);
		const issueId =
			existing?.id ??
			run(
				db,
				"INSERT INTO issues (project_id, fingerprint, title, culprit, level, status, first_seen, last_seen, event_count) VALUES (?, ?, ?, ?, ?, 'unresolved', ?, ?, 0)",
				project.id,
				fingerprint,
				issueTitle(event),
				issueCulprit(event),
				event.level,
				now,
				now,
			).lastInsertRowid;

		run(
			db,
			"INSERT INTO events (id, issue_id, project_id, received_at, level, release, environment, platform, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
			event.event_id,
			issueId,
			project.id,
			now,
			event.level,
			event.release ?? null,
			event.environment ?? null,
			event.platform,
			JSON.stringify(event),
		);
		run(
			db,
			"UPDATE issues SET last_seen = ?, event_count = event_count + 1, level = ?, last_release = COALESCE(?, last_release) WHERE id = ?",
			now,
			event.level,
			event.release ?? null,
			issueId,
		);

		const windowCount =
			get<{ count: number }>(
				db,
				"SELECT COUNT(*) AS count FROM events WHERE issue_id = ? AND received_at >= ?",
				issueId,
				now - config.rules.thresholdWindowMs,
			)?.count ?? 1;
		const decision = evaluateRules({
			isNew: !existing,
			previousStatus: existing?.status ?? null,
			resolvedRelease: existing?.resolved_release ?? null,
			eventRelease: event.release ?? null,
			level: event.level,
			windowCount,
			lastAlertAt: existing?.last_alert_at ?? null,
			now,
			config: config.rules,
		});
		if (decision.reopen) {
			run(
				db,
				"UPDATE issues SET status = 'unresolved', resolved_release = NULL, resolved_at = NULL WHERE id = ?",
				issueId,
			);
		}

		let alert: IngestResult["alert"] = null;
		if (decision.alert) {
			const issue = getIssue(db, issueId);
			if (!issue) throw new Error(`Issue ${issueId} disappeared mid-ingest`);
			// The cap keeps an error storm from burning through factory runs.
			const suppressed =
				alertsInLastDay(db, project.id, now) >= config.rules.dailyAlertCap;
			const alertId = randomId("alert");
			const payload = buildAlertPayload({
				alertId,
				type: decision.alert,
				project,
				issue,
				event,
				publicUrl: config.publicUrl,
				rules: config.rules,
				now,
			});
			const row: AlertRow = {
				id: alertId,
				project_id: project.id,
				issue_id: issueId,
				type: decision.alert,
				suppressed: suppressed ? 1 : 0,
				created_at: now,
				payload: JSON.stringify(payload),
			};
			insertAlert(db, row);
			run(db, "UPDATE issues SET last_alert_at = ? WHERE id = ?", now, issueId);
			if (!suppressed) enqueueDeliveries(db, row, now);
			alert = { id: alertId, type: decision.alert, suppressed };
		}

		run(
			db,
			`DELETE FROM events WHERE issue_id = ? AND id NOT IN (
				SELECT id FROM events WHERE issue_id = ? ORDER BY received_at DESC LIMIT ?
			)`,
			issueId,
			issueId,
			EVENTS_KEPT_PER_ISSUE,
		);

		return { eventId: event.event_id, issueId, duplicate: false, alert };
	});
}

/** Queues a test alert to one endpoint. Doesn't count toward the daily cap. */
export function sendTestAlert(
	deps: Pick<IngestDeps, "db" | "now">,
	project: ProjectRow,
	endpointId: string,
): string {
	const now = deps.now();
	const alertId = randomId("alert");
	const row: AlertRow = {
		id: alertId,
		project_id: project.id,
		issue_id: null,
		type: "test",
		suppressed: 0,
		created_at: now,
		payload: JSON.stringify(buildTestPayload({ alertId, project, now })),
	};
	transaction(deps.db, () => {
		insertAlert(deps.db, row);
		enqueueDeliveries(deps.db, row, now, endpointId);
	});
	return alertId;
}
