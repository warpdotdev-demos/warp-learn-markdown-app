import type { AlertType, IssueStatus, Level, RuleConfig } from "./types.js";

const ALERTABLE_LEVELS = new Set<Level>(["error", "fatal"]);

export type RuleInput = {
	isNew: boolean;
	previousStatus: IssueStatus | null;
	resolvedRelease: string | null;
	eventRelease: string | null;
	level: Level;
	/** Events for this issue inside the threshold window, including this one. */
	windowCount: number;
	lastAlertAt: number | null;
	now: number;
	config: RuleConfig;
};

export type RuleDecision = {
	/** Move a resolved issue back to unresolved. */
	reopen: boolean;
	alert: Exclude<AlertType, "test"> | null;
};

/**
 * Resolving records the release that was current at the time. More events from
 * that same release are the old build still running, not a regression.
 */
export function isRegression(
	previousStatus: IssueStatus | null,
	resolvedRelease: string | null,
	eventRelease: string | null,
): boolean {
	if (previousStatus !== "resolved") return false;
	return !(resolvedRelease && eventRelease && resolvedRelease === eventRelease);
}

export function evaluateRules(input: RuleInput): RuleDecision {
	const reopen = isRegression(
		input.previousStatus,
		input.resolvedRelease,
		input.eventRelease,
	);
	// Warnings are recorded and grouped but never page anyone.
	if (!ALERTABLE_LEVELS.has(input.level)) return { reopen, alert: null };
	if (input.isNew) return { reopen, alert: "issue.created" };
	if (reopen) return { reopen, alert: "issue.regressed" };
	if (input.previousStatus !== "unresolved") return { reopen, alert: null };

	// Any alert starts a cooldown, so a burst right after `issue.created`
	// doesn't immediately send a second alert for the same problem.
	const cooledDown =
		input.lastAlertAt === null ||
		input.now - input.lastAlertAt >= input.config.thresholdWindowMs;
	if (input.windowCount >= input.config.thresholdCount && cooledDown) {
		return { reopen, alert: "issue.threshold" };
	}
	return { reopen, alert: null };
}
