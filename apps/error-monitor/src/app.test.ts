import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { DEFAULT_RULES } from "./config.js";
import { type Db, openDb } from "./db.js";
import type { AlertPayload } from "./payload.js";
import {
	createEndpoint,
	ensureProject,
	getIssue,
	setIssueStatus,
} from "./store.js";
import type { EndpointRow, ProjectRow } from "./types.js";
import { startDeliveryWorker } from "./webhooks/delivery.js";
import { verifyPayload } from "./webhooks/sign.js";

type Received = { url: string; headers: Headers; body: string };

let db: Db;
let project: ProjectRow;
let endpoint: EndpointRow;
let clock: number;
let received: Received[];
let respondWith: number[];

const now = () => clock;
const config = {
	publicUrl: "http://localhost:4747",
	rules: { ...DEFAULT_RULES, thresholdCount: 3, dailyAlertCap: 5 },
};

const fakeFetch: typeof fetch = async (input, init) => {
	received.push({
		url: String(input),
		headers: new Headers(init?.headers),
		body: String(init?.body),
	});
	return new Response("", { status: respondWith.shift() ?? 200 });
};

beforeEach(() => {
	db = openDb(":memory:");
	clock = Date.UTC(2026, 9, 28, 12);
	project = ensureProject(db, "marky", { key: "testkey", now: clock });
	endpoint = createEndpoint(db, {
		projectId: project.id,
		url: "https://factory.example/webhooks/abc",
		authMode: "signature",
		now: clock,
	});
	received = [];
	respondWith = [];
});

function setup() {
	const app = createApp({ db, config, now });
	const worker = startDeliveryWorker(db, {
		fetch: fakeFetch,
		now,
		autoStart: false,
	});
	const ingest = (events: unknown[], key = "testkey") =>
		app.request("/api/projects/marky/events", {
			method: "POST",
			headers: { "content-type": "application/json", "x-monitor-key": key },
			body: JSON.stringify({ events }),
		});
	return { app, worker, ingest };
}

function crash(overrides: Record<string, unknown> = {}) {
	return {
		level: "error",
		platform: "electron-renderer",
		handled: false,
		release: "marky@1.0.0",
		exception: {
			type: "TypeError",
			value: "Cannot read properties of null (reading 'length')",
			stacktrace: {
				frames: [
					{
						filename: "/app/src/ReviewCommentGutter.tsx",
						function: "ReviewCommentGutter",
						lineno: 278,
						in_app: true,
					},
				],
			},
		},
		...overrides,
	};
}

describe("ingest to webhook", () => {
	it("rejects a bad key and invalid events", async () => {
		const { ingest } = setup();
		expect((await ingest([crash()], "wrong")).status).toBe(401);
		const invalid = await ingest([{ level: "error", platform: "x" }]);
		expect(invalid.status).toBe(400);
	});

	it("creates an issue and delivers a signed issue.created alert", async () => {
		const { ingest, worker } = setup();
		const response = await ingest([crash({ event_id: "evt_00000001" })]);
		expect(response.status).toBe(202);
		const json = (await response.json()) as {
			results: { alert: { type: string } | null }[];
		};
		expect(json.results[0]?.alert?.type).toBe("issue.created");

		await worker.tick();
		expect(received).toHaveLength(1);
		const [delivery] = received;
		if (!delivery) throw new Error("no delivery");
		expect(delivery.url).toBe(endpoint.url);
		expect(
			verifyPayload(
				endpoint.secret ?? "",
				{
					id: delivery.headers.get("webhook-id"),
					timestamp: delivery.headers.get("webhook-timestamp"),
					signature: delivery.headers.get("webhook-signature"),
				},
				delivery.body,
				{ now: clock },
			),
		).toEqual({ ok: true });

		const payload = JSON.parse(delivery.body) as AlertPayload;
		expect(payload.type).toBe("issue.created");
		expect(payload.alert_id).toBe(delivery.headers.get("webhook-id"));
		expect(payload.issue).toMatchObject({
			title: "TypeError: Cannot read properties of null (reading 'length')",
			culprit: "ReviewCommentGutter (ReviewCommentGutter.tsx)",
			release: "marky@1.0.0",
			count: 1,
		});
		expect(payload.event?.exception?.stacktrace?.frames[0]?.lineno).toBe(278);
	});

	it("dedupes a re-sent event id", async () => {
		const { ingest } = setup();
		await ingest([crash({ event_id: "evt_00000001" })]);
		const again = (await (
			await ingest([crash({ event_id: "evt_00000001" })])
		).json()) as { accepted: number };
		expect(again.accepted).toBe(0);
		expect(getIssue(db, 1)?.event_count).toBe(1);
	});

	it("records warnings without alerting", async () => {
		const { ingest, worker } = setup();
		await ingest([crash({ level: "warning" })]);
		await worker.tick();
		expect(received).toHaveLength(0);
		expect(getIssue(db, 1)?.level).toBe("warning");
	});

	it("retries failed deliveries with the same webhook-id", async () => {
		const { ingest, worker } = setup();
		respondWith = [500, 200];
		await ingest([crash()]);
		await worker.tick();
		await worker.tick(); // not due yet
		expect(received).toHaveLength(1);
		clock += 5_000;
		await worker.tick();
		expect(received).toHaveLength(2);
		expect(received[1]?.headers.get("webhook-id")).toBe(
			received[0]?.headers.get("webhook-id"),
		);
		const status = db
			.prepare("SELECT status, attempts FROM webhook_deliveries")
			.get();
		expect(status).toMatchObject({ status: "success", attempts: 2 });
	});

	it("regresses only on a newer release after resolve", async () => {
		const { ingest, worker } = setup();
		await ingest([crash()]);
		setIssueStatus(db, 1, "resolved", clock);
		expect(getIssue(db, 1)?.resolved_release).toBe("marky@1.0.0");

		clock += 60_000;
		await ingest([crash()]);
		expect(getIssue(db, 1)?.status).toBe("resolved");

		clock += 60_000;
		const res = (await (
			await ingest([crash({ release: "marky@1.0.1" })])
		).json()) as { results: { alert: { type: string } | null }[] };
		expect(res.results[0]?.alert?.type).toBe("issue.regressed");
		expect(getIssue(db, 1)?.status).toBe("unresolved");
		await worker.tick();
		expect(
			received.map((r) => (JSON.parse(r.body) as AlertPayload).type),
		).toEqual(["issue.created", "issue.regressed"]);
	});

	it("fires a threshold alert after the post-creation cooldown", async () => {
		const { ingest } = setup();
		await ingest([crash()]);
		await ingest([crash(), crash()]); // 3 in window, but inside creation cooldown
		// Step past the window so the earlier events no longer count.
		clock += config.rules.thresholdWindowMs + 1;
		const res = (await (await ingest([crash(), crash(), crash()])).json()) as {
			results: { alert: { type: string } | null }[];
		};
		expect(res.results.map((r) => r.alert?.type ?? null)).toEqual([
			null,
			null,
			"issue.threshold",
		]);
	});

	it("suppresses alerts past the daily cap", async () => {
		const { ingest, worker } = setup();
		for (let index = 0; index < 6; index += 1) {
			await ingest([
				crash({
					exception: { type: `Error${index}`, value: "boom" },
				}),
			]);
		}
		await worker.tick();
		expect(received).toHaveLength(5);
		const suppressed = db
			.prepare("SELECT COUNT(*) AS count FROM alerts WHERE suppressed = 1")
			.get();
		expect(suppressed).toMatchObject({ count: 1 });
	});
});

describe("dashboard", () => {
	it("renders issues and resolves through a same-origin form post", async () => {
		const { app, ingest } = setup();
		await ingest([crash()]);
		const page = await app.request("/projects/marky/issues");
		expect(page.status).toBe(200);
		expect(await page.text()).toContain("Cannot read properties of null");

		const detail = await app.request("/issues/1");
		expect(await detail.text()).toContain("ReviewCommentGutter");

		const crossSite = await app.request("http://localhost/issues/1/status", {
			method: "POST",
			headers: {
				"content-type": "application/x-www-form-urlencoded",
				origin: "https://evil.example",
			},
			body: "status=resolved",
		});
		expect(crossSite.status).toBe(403);

		const resolve = await app.request("http://localhost/issues/1/status", {
			method: "POST",
			headers: {
				"content-type": "application/x-www-form-urlencoded",
				origin: "http://localhost",
			},
			body: "status=resolved",
		});
		expect(resolve.status).toBe(303);
		expect(getIssue(db, 1)?.status).toBe("resolved");
	});

	it("deletes an issue, keeps its alerts, and reopens fresh on recurrence", async () => {
		const { app, ingest } = setup();
		await ingest([crash()]);
		const page = await (await app.request("/issues/1")).text();
		expect(page).toContain('action="/issues/1/delete"');

		const res = await app.request("http://localhost/issues/1/delete", {
			method: "POST",
			headers: {
				"content-type": "application/x-www-form-urlencoded",
				origin: "http://localhost",
			},
		});
		expect(res.status).toBe(303);
		expect(res.headers.get("location")).toBe("/projects/marky/issues");
		expect(getIssue(db, 1)).toBeUndefined();
		expect(
			db.prepare("SELECT COUNT(*) AS count FROM events").get(),
		).toMatchObject({
			count: 0,
		});
		expect(
			db
				.prepare("SELECT issue_id FROM alerts WHERE type = 'issue.created'")
				.get(),
		).toMatchObject({ issue_id: null });

		const again = (await (await ingest([crash()])).json()) as {
			results: { issue_id: string; alert: { type: string } | null }[];
		};
		expect(again.results[0]).toMatchObject({
			issue_id: "iss_2",
			alert: { type: "issue.created" },
		});
	});

	it("sends a test alert that doesn't count toward the cap", async () => {
		const { app, worker } = setup();
		const res = await app.request(
			`http://localhost/webhooks/${endpoint.id}/test`,
			{
				method: "POST",
				headers: {
					"content-type": "application/x-www-form-urlencoded",
					origin: "http://localhost",
				},
			},
		);
		expect(res.status).toBe(303);
		await worker.tick();
		expect((JSON.parse(received[0]?.body ?? "{}") as AlertPayload).type).toBe(
			"test",
		);
		const page = await app.request("/projects/marky/webhooks");
		expect(await page.text()).toContain("0 of 5 alerts used");
	});
});
