import { all, type Db, get, run } from "./db.js";
import { randomHex, randomId } from "./ids.js";
import type {
	AlertRow,
	AuthMode,
	DeliveryRow,
	EndpointRow,
	EventRow,
	IssueRow,
	IssueStatus,
	ProjectRow,
} from "./types.js";
import { generateSecret } from "./webhooks/sign.js";

// Projects

export function ensureProject(
	db: Db,
	id: string,
	options: { name?: string; key?: string; now: number },
): ProjectRow {
	const existing = getProject(db, id);
	if (existing) {
		if (options.key && existing.dsn_key !== options.key) {
			run(db, "UPDATE projects SET dsn_key = ? WHERE id = ?", options.key, id);
			return { ...existing, dsn_key: options.key };
		}
		return existing;
	}
	const project: ProjectRow = {
		id,
		name: options.name ?? id,
		dsn_key: options.key ?? randomHex(16),
		created_at: options.now,
	};
	run(
		db,
		"INSERT INTO projects (id, name, dsn_key, created_at) VALUES (?, ?, ?, ?)",
		project.id,
		project.name,
		project.dsn_key,
		project.created_at,
	);
	return project;
}

export function getProject(db: Db, id: string) {
	return get<ProjectRow>(db, "SELECT * FROM projects WHERE id = ?", id);
}

export function listProjects(db: Db) {
	return all<ProjectRow>(db, "SELECT * FROM projects ORDER BY created_at");
}

export function dsnFor(project: ProjectRow, publicUrl: string): string {
	const url = new URL(publicUrl);
	return `${url.protocol}//${project.dsn_key}@${url.host}/${project.id}`;
}

// Issues

export function getIssue(db: Db, id: number) {
	return get<IssueRow>(db, "SELECT * FROM issues WHERE id = ?", id);
}

export function listIssues(
	db: Db,
	projectId: string,
	status: IssueStatus | "all",
) {
	return status === "all"
		? all<IssueRow>(
				db,
				"SELECT * FROM issues WHERE project_id = ? ORDER BY last_seen DESC LIMIT 200",
				projectId,
			)
		: all<IssueRow>(
				db,
				"SELECT * FROM issues WHERE project_id = ? AND status = ? ORDER BY last_seen DESC LIMIT 200",
				projectId,
				status,
			);
}

export function issueCounts(db: Db, projectId: string) {
	const rows = all<{ status: IssueStatus; count: number }>(
		db,
		"SELECT status, COUNT(*) AS count FROM issues WHERE project_id = ? GROUP BY status",
		projectId,
	);
	const counts: Record<IssueStatus, number> = {
		unresolved: 0,
		resolved: 0,
		ignored: 0,
	};
	for (const row of rows) counts[row.status] = row.count;
	return counts;
}

/** Resolving records the issue's latest release, so late events from that build don't regress it. */
export function setIssueStatus(
	db: Db,
	id: number,
	status: IssueStatus,
	now: number,
) {
	if (status === "resolved") {
		run(
			db,
			"UPDATE issues SET status = 'resolved', resolved_release = last_release, resolved_at = ? WHERE id = ?",
			now,
			id,
		);
		return;
	}
	run(
		db,
		"UPDATE issues SET status = ?, resolved_release = NULL, resolved_at = NULL WHERE id = ?",
		status,
		id,
	);
}

/**
 * Deletes an issue and its events. Alerts stay as history with no issue, so
 * the next occurrence starts a fresh issue and alerts `issue.created` again.
 */
export function deleteIssue(db: Db, id: number) {
	run(db, "DELETE FROM issues WHERE id = ?", id);
}

/** Hourly event counts over the last 24h, oldest first, for issue sparklines. */
export function hourlyCounts(
	db: Db,
	issueIds: number[],
	now: number,
): Map<number, number[]> {
	const result = new Map<number, number[]>(
		issueIds.map((id) => [id, Array.from({ length: 24 }, () => 0)]),
	);
	if (issueIds.length === 0) return result;
	const since = now - 24 * 3_600_000;
	const rows = all<{ issue_id: number; received_at: number }>(
		db,
		`SELECT issue_id, received_at FROM events WHERE received_at >= ? AND issue_id IN (${issueIds.map(() => "?").join(",")})`,
		since,
		...issueIds,
	);
	for (const row of rows) {
		const bucket = Math.min(
			23,
			Math.floor((row.received_at - since) / 3_600_000),
		);
		const counts = result.get(row.issue_id);
		if (counts) counts[bucket] = (counts[bucket] ?? 0) + 1;
	}
	return result;
}

// Events

export function recentEvents(db: Db, issueId: number, limit = 20) {
	return all<EventRow>(
		db,
		"SELECT * FROM events WHERE issue_id = ? ORDER BY received_at DESC LIMIT ?",
		issueId,
		limit,
	);
}

// Webhook endpoints

export function listEndpoints(db: Db, projectId: string) {
	return all<EndpointRow>(
		db,
		"SELECT * FROM webhook_endpoints WHERE project_id = ? ORDER BY created_at",
		projectId,
	);
}

export function getEndpoint(db: Db, id: string) {
	return get<EndpointRow>(
		db,
		"SELECT * FROM webhook_endpoints WHERE id = ?",
		id,
	);
}

export function createEndpoint(
	db: Db,
	input: {
		projectId: string;
		url: string;
		authMode: AuthMode;
		secret?: string;
		now: number;
	},
): EndpointRow {
	const endpoint: EndpointRow = {
		id: randomId("wh"),
		project_id: input.projectId,
		url: input.url,
		auth_mode: input.authMode,
		secret:
			input.authMode === "none"
				? null
				: input.secret ||
					(input.authMode === "signature" ? generateSecret() : randomHex(24)),
		enabled: 1,
		created_at: input.now,
	};
	run(
		db,
		"INSERT INTO webhook_endpoints (id, project_id, url, auth_mode, secret, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
		endpoint.id,
		endpoint.project_id,
		endpoint.url,
		endpoint.auth_mode,
		endpoint.secret,
		endpoint.enabled,
		endpoint.created_at,
	);
	return endpoint;
}

export function deleteEndpoint(db: Db, id: string) {
	run(db, "DELETE FROM webhook_endpoints WHERE id = ?", id);
}

export function toggleEndpoint(db: Db, id: string) {
	run(
		db,
		"UPDATE webhook_endpoints SET enabled = 1 - enabled WHERE id = ?",
		id,
	);
}

// Alerts and deliveries

export function getAlert(db: Db, id: string) {
	return get<AlertRow>(db, "SELECT * FROM alerts WHERE id = ?", id);
}

export function insertAlert(db: Db, alert: AlertRow) {
	run(
		db,
		"INSERT INTO alerts (id, project_id, issue_id, type, suppressed, created_at, payload) VALUES (?, ?, ?, ?, ?, ?, ?)",
		alert.id,
		alert.project_id,
		alert.issue_id,
		alert.type,
		alert.suppressed,
		alert.created_at,
		alert.payload,
	);
}

/** Real alerts in the last 24h; test alerts and suppressed alerts don't count toward the cap. */
export function alertsInLastDay(db: Db, projectId: string, now: number) {
	return (
		get<{ count: number }>(
			db,
			"SELECT COUNT(*) AS count FROM alerts WHERE project_id = ? AND created_at >= ? AND suppressed = 0 AND type != 'test'",
			projectId,
			now - 24 * 3_600_000,
		)?.count ?? 0
	);
}

export type AlertWithDeliveries = AlertRow & {
	deliveries: (DeliveryRow & { url: string })[];
};

export function recentAlerts(
	db: Db,
	projectId: string,
	options: { issueId?: number; limit?: number } = {},
): AlertWithDeliveries[] {
	const alerts =
		options.issueId === undefined
			? all<AlertRow>(
					db,
					"SELECT * FROM alerts WHERE project_id = ? ORDER BY created_at DESC LIMIT ?",
					projectId,
					options.limit ?? 30,
				)
			: all<AlertRow>(
					db,
					"SELECT * FROM alerts WHERE issue_id = ? ORDER BY created_at DESC LIMIT ?",
					options.issueId,
					options.limit ?? 10,
				);
	if (alerts.length === 0) return [];
	const deliveries = all<DeliveryRow & { url: string }>(
		db,
		`SELECT d.*, e.url FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id = d.endpoint_id WHERE d.alert_id IN (${alerts.map(() => "?").join(",")}) ORDER BY d.id`,
		...alerts.map((alert) => alert.id),
	);
	return alerts.map((alert) => ({
		...alert,
		deliveries: deliveries.filter((delivery) => delivery.alert_id === alert.id),
	}));
}
