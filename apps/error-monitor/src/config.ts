import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AuthMode, RuleConfig } from "./types.js";

export type MonitorConfig = {
	port: number;
	host: string;
	dbPath: string;
	/** Base URL for dashboard links in alerts. Humans only: cloud agents can't reach localhost. */
	publicUrl: string;
	projectId: string;
	/** Fixed DSN key for the default project, so app config survives a database reset. */
	projectKey?: string;
	/** Directories source maps may be read from. Defaults to the monorepo root. */
	sourceRoots: string[];
	rules: RuleConfig;
	seedWebhook?: { url: string; authMode: AuthMode; secret?: string };
};

const APP_ROOT = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);

export const DEFAULT_RULES: RuleConfig = {
	thresholdCount: 10,
	thresholdWindowMs: 5 * 60_000,
	dailyAlertCap: 50,
};

export function loadConfig(
	env: NodeJS.ProcessEnv = process.env,
): MonitorConfig {
	const port = intFrom(env.MONITOR_PORT, 4747);
	const webhookUrl = env.MONITOR_WEBHOOK_URL?.trim();
	return {
		port,
		host: env.MONITOR_HOST ?? "127.0.0.1",
		dbPath: env.MONITOR_DB_PATH ?? path.join(APP_ROOT, "data", "monitor.db"),
		publicUrl: (env.MONITOR_PUBLIC_URL ?? `http://localhost:${port}`).replace(
			/\/+$/,
			"",
		),
		projectId: env.MONITOR_PROJECT_ID ?? "marky",
		projectKey: env.MONITOR_PROJECT_KEY || undefined,
		sourceRoots: env.MONITOR_SOURCE_ROOTS
			? env.MONITOR_SOURCE_ROOTS.split(",").map((root) => root.trim())
			: [path.resolve(APP_ROOT, "..", "..")],
		rules: {
			thresholdCount: intFrom(
				env.MONITOR_THRESHOLD_COUNT,
				DEFAULT_RULES.thresholdCount,
			),
			thresholdWindowMs:
				intFrom(env.MONITOR_THRESHOLD_WINDOW_MINUTES, 5) * 60_000,
			dailyAlertCap: intFrom(
				env.MONITOR_DAILY_ALERT_CAP,
				DEFAULT_RULES.dailyAlertCap,
			),
		},
		seedWebhook: webhookUrl
			? {
					url: webhookUrl,
					authMode: authModeFrom(env.MONITOR_WEBHOOK_AUTH),
					secret: env.MONITOR_WEBHOOK_SECRET || undefined,
				}
			: undefined,
	};
}

function intFrom(value: string | undefined, fallback: number): number {
	const parsed = Number.parseInt(value ?? "", 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function authModeFrom(value: unknown): AuthMode {
	return value === "token" || value === "none" ? value : "signature";
}
