export type Level = "fatal" | "error" | "warning" | "info";
export type IssueStatus = "unresolved" | "resolved" | "ignored";
/** How a webhook endpoint authenticates deliveries; maps onto Warp factory webhook `authMode`. */
export type AuthMode = "signature" | "token" | "none";
export type AlertType =
	| "issue.created"
	| "issue.regressed"
	| "issue.threshold"
	| "test";

export type RuleConfig = {
	/** Events within the window that trigger `issue.threshold`. */
	thresholdCount: number;
	thresholdWindowMs: number;
	/** Alerts per project per rolling 24h before further alerts are suppressed. */
	dailyAlertCap: number;
};

export type ProjectRow = {
	id: string;
	name: string;
	dsn_key: string;
	created_at: number;
};

export type IssueRow = {
	id: number;
	project_id: string;
	fingerprint: string;
	title: string;
	culprit: string | null;
	level: Level;
	status: IssueStatus;
	resolved_release: string | null;
	resolved_at: number | null;
	first_seen: number;
	last_seen: number;
	event_count: number;
	last_release: string | null;
	last_alert_at: number | null;
};

export type EventRow = {
	id: string;
	issue_id: number;
	project_id: string;
	received_at: number;
	level: Level;
	release: string | null;
	environment: string | null;
	platform: string | null;
	payload: string;
};

export type EndpointRow = {
	id: string;
	project_id: string;
	url: string;
	auth_mode: AuthMode;
	secret: string | null;
	enabled: number;
	created_at: number;
};

export type AlertRow = {
	id: string;
	project_id: string;
	issue_id: number | null;
	type: AlertType;
	suppressed: number;
	created_at: number;
	payload: string;
};

export type DeliveryStatus = "pending" | "success" | "failed";

export type DeliveryRow = {
	id: number;
	alert_id: string;
	endpoint_id: string;
	status: DeliveryStatus;
	attempts: number;
	next_attempt_at: number | null;
	response_status: number | null;
	error: string | null;
	created_at: number;
	updated_at: number;
};
