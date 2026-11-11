import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
import { authModeFrom, type MonitorConfig } from "./config.js";
import type { Db } from "./db.js";
import { ingestBodySchema } from "./eventSchema.js";
import { ingestEvent, sendTestAlert } from "./ingest.js";
import {
	createEndpoint,
	deleteEndpoint,
	deleteIssue,
	dsnFor,
	getEndpoint,
	getIssue,
	getProject,
	hourlyCounts,
	issueCounts,
	listEndpoints,
	listIssues,
	listProjects,
	recentAlerts,
	recentEvents,
	setIssueStatus,
	toggleEndpoint,
} from "./store.js";
import type { Symbolicator } from "./symbolicate.js";
import type { IssueStatus } from "./types.js";
import { IssuePage } from "./views/issue.js";
import { IssuesPage } from "./views/issues.js";
import { WebhooksPage } from "./views/webhooks.js";

export type AppDeps = {
	db: Db;
	config: Pick<MonitorConfig, "publicUrl" | "rules">;
	now?: () => number;
	/** Resolves bundled frames through source maps before grouping. */
	symbolicator?: Symbolicator;
};

const STATUSES = new Set<IssueStatus>(["unresolved", "resolved", "ignored"]);
const MAX_BODY_BYTES = 1024 * 1024;

export function createApp(deps: AppDeps) {
	const { db, config } = deps;
	const now = deps.now ?? Date.now;
	const app = new Hono();

	// Ingest API

	app.use(
		"/api/*",
		cors({
			origin: "*",
			allowMethods: ["GET", "POST", "OPTIONS"],
			allowHeaders: ["content-type", "x-monitor-key"],
		}),
	);

	app.get("/api/health", (c) => c.json({ ok: true }));

	app.post(
		"/api/projects/:projectId/events",
		bodyLimit({
			maxSize: MAX_BODY_BYTES,
			onError: (c) => c.json({ error: "Payload too large" }, 413),
		}),
		async (c) => {
			const project = getProject(db, c.req.param("projectId"));
			const key = c.req.header("x-monitor-key") ?? c.req.query("key");
			if (!project || !key || key !== project.dsn_key) {
				return c.json({ error: "Unknown project or invalid key" }, 401);
			}
			let body: unknown;
			try {
				body = await c.req.json();
			} catch {
				return c.json({ error: "Body must be JSON" }, 400);
			}
			const parsed = ingestBodySchema.safeParse(body);
			if (!parsed.success) {
				return c.json(
					{ error: "Invalid event", issues: parsed.error.issues.slice(0, 10) },
					400,
				);
			}
			const received =
				"events" in parsed.data ? parsed.data.events : [parsed.data];
			const { symbolicator } = deps;
			const events = symbolicator
				? await Promise.all(
						received.map((event) => symbolicator.symbolicate(event)),
					)
				: received;
			const results = events.map((event) =>
				ingestEvent({ db, config, now }, project, event),
			);
			return c.json(
				{
					accepted: results.filter((result) => !result.duplicate).length,
					results: results.map((result) => ({
						event_id: result.eventId,
						issue_id: `iss_${result.issueId}`,
						duplicate: result.duplicate,
						alert: result.alert,
					})),
				},
				202,
			);
		},
	);

	app.get("/api/projects/:projectId/issues", (c) => {
		const project = getProject(db, c.req.param("projectId"));
		const key = c.req.header("x-monitor-key") ?? c.req.query("key");
		if (!project || key !== project.dsn_key) {
			return c.json({ error: "Unknown project or invalid key" }, 401);
		}
		return c.json({
			issues: listIssues(db, project.id, statusFrom(c.req.query("status"))),
		});
	});

	// Dashboard. Same-origin form posts only.

	app.use("*", csrf());

	app.get("/", (c) => {
		const project = listProjects(db)[0];
		return project
			? c.redirect(`/projects/${project.id}/issues`)
			: c.text("No projects yet.", 404);
	});

	app.get("/projects/:projectId/issues", (c) => {
		const project = getProject(db, c.req.param("projectId"));
		if (!project) return c.notFound();
		const status = statusFrom(c.req.query("status"));
		const issues = listIssues(db, project.id, status);
		const current = now();
		return c.html(
			<IssuesPage
				project={project}
				issues={issues}
				counts={issueCounts(db, project.id)}
				status={status}
				sparks={hourlyCounts(
					db,
					issues.map((issue) => issue.id),
					current,
				)}
				dsn={dsnFor(project, config.publicUrl)}
				now={current}
			/>,
		);
	});

	app.get("/issues/:id", (c) => {
		const issue = getIssue(db, Number(c.req.param("id")));
		const project = issue && getProject(db, issue.project_id);
		if (!issue || !project) return c.notFound();
		return c.html(
			<IssuePage
				project={project}
				issue={issue}
				events={recentEvents(db, issue.id)}
				alerts={recentAlerts(db, project.id, { issueId: issue.id })}
				now={now()}
			/>,
		);
	});

	app.post("/issues/:id/status", async (c) => {
		const id = Number(c.req.param("id"));
		const form = await c.req.parseBody();
		const status = String(form.status ?? "");
		if (!getIssue(db, id) || !STATUSES.has(status as IssueStatus)) {
			return c.text("Bad request", 400);
		}
		setIssueStatus(db, id, status as IssueStatus, now());
		return c.redirect(`/issues/${id}`, 303);
	});

	app.post("/issues/:id/delete", (c) => {
		const issue = getIssue(db, Number(c.req.param("id")));
		if (!issue) return c.notFound();
		deleteIssue(db, issue.id);
		return c.redirect(`/projects/${issue.project_id}/issues`, 303);
	});

	app.get("/projects/:projectId/webhooks", (c) => {
		const project = getProject(db, c.req.param("projectId"));
		if (!project) return c.notFound();
		const current = now();
		return c.html(
			<WebhooksPage
				project={project}
				endpoints={listEndpoints(db, project.id)}
				alerts={recentAlerts(db, project.id)}
				dsn={dsnFor(project, config.publicUrl)}
				now={current}
			/>,
		);
	});

	app.post("/projects/:projectId/webhooks", async (c) => {
		const project = getProject(db, c.req.param("projectId"));
		if (!project) return c.notFound();
		const form = await c.req.parseBody();
		const url = String(form.url ?? "").trim();
		if (!/^https?:\/\//.test(url)) return c.text("URL must be http(s)", 400);
		createEndpoint(db, {
			projectId: project.id,
			url,
			authMode: authModeFrom(form.auth_mode),
			secret: String(form.secret ?? "").trim() || undefined,
			now: now(),
		});
		return c.redirect(`/projects/${project.id}/webhooks`, 303);
	});

	app.post("/webhooks/:id/:action{test|toggle|delete}", (c) => {
		const endpoint = getEndpoint(db, c.req.param("id"));
		const project = endpoint && getProject(db, endpoint.project_id);
		if (!endpoint || !project) return c.notFound();
		const action = c.req.param("action");
		if (action === "test") sendTestAlert({ db, now }, project, endpoint.id);
		if (action === "toggle") toggleEndpoint(db, endpoint.id);
		if (action === "delete") deleteEndpoint(db, endpoint.id);
		return c.redirect(`/projects/${project.id}/webhooks`, 303);
	});

	app.onError((error, c) => {
		// Middleware like csrf() signals rejections this way; keep their status.
		if (error instanceof HTTPException) return error.getResponse();
		console.error(error);
		return c.req.path.startsWith("/api/")
			? c.json({ error: "Internal error" }, 500)
			: c.text("Internal error", 500);
	});

	return app;
}

function statusFrom(value: string | undefined): IssueStatus | "all" {
	return value === "all" || STATUSES.has(value as IssueStatus)
		? (value as IssueStatus | "all")
		: "unresolved";
}
