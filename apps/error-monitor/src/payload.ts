import type { IncomingEvent } from "./eventSchema.js";
import { issuePublicId } from "./ids.js";
import type { AlertType, IssueRow, ProjectRow, RuleConfig } from "./types.js";

const MAX_BREADCRUMBS = 20;

export type AlertPayload = {
	type: AlertType;
	alert_id: string;
	created_at: string;
	project: { id: string; name: string };
	issue: {
		id: string;
		title: string;
		culprit: string | null;
		level: string;
		status: string;
		fingerprint: string;
		count: number;
		first_seen: string;
		last_seen: string;
		release: string | null;
		url: string;
		url_note: string;
	} | null;
	event: (IncomingEvent & { event_id: string }) | null;
	trigger: {
		rule: AlertType;
		description: string;
		threshold?: { count: number; window_minutes: number };
	};
};

const URL_NOTE =
	"Dashboard link for humans on the machine running the monitor. Cloud agents can't reach it; everything needed to triage is in this payload.";

export function buildAlertPayload(input: {
	alertId: string;
	type: Exclude<AlertType, "test">;
	project: ProjectRow;
	issue: IssueRow;
	event: IncomingEvent & { event_id: string };
	publicUrl: string;
	rules: RuleConfig;
	now: number;
}): AlertPayload {
	const { issue, event } = input;
	return {
		type: input.type,
		alert_id: input.alertId,
		created_at: new Date(input.now).toISOString(),
		project: { id: input.project.id, name: input.project.name },
		issue: {
			id: issuePublicId(issue.id),
			title: issue.title,
			culprit: issue.culprit,
			level: issue.level,
			status: issue.status,
			fingerprint: issue.fingerprint,
			count: issue.event_count,
			first_seen: new Date(issue.first_seen).toISOString(),
			last_seen: new Date(issue.last_seen).toISOString(),
			release: issue.last_release,
			url: `${input.publicUrl}/issues/${issue.id}`,
			url_note: URL_NOTE,
		},
		event: {
			...event,
			breadcrumbs: event.breadcrumbs?.slice(-MAX_BREADCRUMBS),
		},
		trigger: describeTrigger(input.type, input.rules),
	};
}

export function buildTestPayload(input: {
	alertId: string;
	project: ProjectRow;
	now: number;
}): AlertPayload {
	return {
		type: "test",
		alert_id: input.alertId,
		created_at: new Date(input.now).toISOString(),
		project: { id: input.project.id, name: input.project.name },
		issue: null,
		event: null,
		trigger: {
			rule: "test",
			description:
				"Test alert sent from the dashboard to check delivery and signatures. No action needed.",
		},
	};
}

function describeTrigger(
	type: Exclude<AlertType, "test">,
	rules: RuleConfig,
): AlertPayload["trigger"] {
	const windowMinutes = Math.round(rules.thresholdWindowMs / 60_000);
	switch (type) {
		case "issue.created":
			return {
				rule: type,
				description: "First occurrence of a new error.",
			};
		case "issue.regressed":
			return {
				rule: type,
				description:
					"An issue marked resolved occurred again in a different release.",
			};
		case "issue.threshold":
			return {
				rule: type,
				description: `At least ${rules.thresholdCount} events in ${windowMinutes} minutes.`,
				threshold: {
					count: rules.thresholdCount,
					window_minutes: windowMinutes,
				},
			};
	}
}
