import { describe, expect, it } from "vitest";
import { DEFAULT_RULES } from "./config.js";
import type { IncomingEvent } from "./eventSchema.js";
import {
	computeFingerprint,
	issueCulprit,
	issueTitle,
	normalizeFilename,
	normalizeMessage,
} from "./fingerprint.js";
import { evaluateRules, type RuleInput } from "./rules.js";
import { signPayload, verifyPayload } from "./webhooks/sign.js";

describe("Standard Webhooks signing", () => {
	// Test vector from the Standard Webhooks reference implementations.
	const secret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
	const id = "msg_p5jXN8AQM9LWM0D4loKWxJek";
	const timestamp = 1614265330;
	const body = '{"test": 2432232314}';
	const expected = "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=";

	it("matches the spec test vector", () => {
		expect(signPayload(secret, id, timestamp, body)).toBe(expected);
	});

	it("verifies within tolerance and rejects tampering or skew", () => {
		const headers = { id, timestamp: String(timestamp), signature: expected };
		const now = timestamp * 1000;
		expect(verifyPayload(secret, headers, body, { now })).toEqual({ ok: true });
		expect(
			verifyPayload(
				secret,
				{ ...headers, signature: `v1,bogus ${expected}` },
				body,
				{
					now,
				},
			),
		).toEqual({ ok: true });
		expect(verifyPayload(secret, headers, `${body} `, { now }).ok).toBe(false);
		expect(
			verifyPayload(secret, headers, body, { now: now + 10 * 60_000 }),
		).toMatchObject({
			ok: false,
			reason: expect.stringContaining("clock skew"),
		});
	});
});

function exceptionEvent(
	overrides: Partial<IncomingEvent> = {},
	lineno = 10,
): IncomingEvent {
	return {
		level: "error",
		platform: "electron-renderer",
		handled: false,
		exception: {
			type: "TypeError",
			value: "Cannot read properties of null (reading 'length')",
			stacktrace: {
				frames: [
					{
						filename: "/app/node_modules/react-dom/index.js",
						function: "renderWithHooks",
						lineno: 1,
						in_app: false,
					},
					{
						filename: "file:///app/out/renderer/assets/index-DWbuZQEI.js",
						function: "ReviewCommentGutter",
						lineno,
						in_app: true,
					},
				],
			},
		},
		...overrides,
	};
}

describe("fingerprinting", () => {
	it("ignores line numbers and bundle hashes", () => {
		const first = exceptionEvent({}, 10);
		const nextBuild = exceptionEvent({}, 99);
		const frames = nextBuild.exception?.stacktrace?.frames ?? [];
		if (frames[1])
			frames[1].filename = "/app/out/renderer/assets/index-Zx9QwErT.js";
		expect(computeFingerprint(nextBuild)).toBe(computeFingerprint(first));
	});

	it("separates different exception types at the same frame", () => {
		const other = exceptionEvent();
		if (other.exception) other.exception.type = "RangeError";
		expect(computeFingerprint(other)).not.toBe(
			computeFingerprint(exceptionEvent()),
		);
	});

	it("groups frameless errors by normalized message", () => {
		const event = (path: string): IncomingEvent => ({
			level: "error",
			platform: "electron-main",
			handled: true,
			exception: {
				type: "Error",
				value: `ENOENT: no such file or directory, open '${path}'`,
			},
		});
		expect(computeFingerprint(event("/Users/a/notes/one.md"))).toBe(
			computeFingerprint(event("/Users/b/other/two.md")),
		);
	});

	it("honors a custom fingerprint", () => {
		expect(computeFingerprint(exceptionEvent({ fingerprint: ["x"] }))).toBe(
			computeFingerprint({
				level: "info",
				platform: "node",
				handled: true,
				message: "different",
				fingerprint: ["x"],
			}),
		);
	});

	it("builds titles and culprits from the top in-app frame", () => {
		expect(issueTitle(exceptionEvent())).toBe(
			"TypeError: Cannot read properties of null (reading 'length')",
		);
		expect(issueCulprit(exceptionEvent())).toBe(
			"ReviewCommentGutter (index.js)",
		);
		expect(normalizeFilename("C:\\app\\main-abcdEFGH.mjs?x=1")).toBe(
			"main.mjs",
		);
		expect(normalizeMessage("Unexpected token } in JSON at position 42")).toBe(
			"Unexpected token } in JSON at position <n>",
		);
	});
});

describe("alert rules", () => {
	const base: RuleInput = {
		isNew: false,
		previousStatus: "unresolved",
		resolvedRelease: null,
		eventRelease: "marky@1.0.0",
		level: "error",
		windowCount: 1,
		lastAlertAt: null,
		now: 1_000_000,
		config: DEFAULT_RULES,
	};

	it("alerts on new error issues but never on warnings", () => {
		expect(evaluateRules({ ...base, isNew: true }).alert).toBe("issue.created");
		expect(
			evaluateRules({ ...base, isNew: true, level: "warning" }).alert,
		).toBe(null);
	});

	it("treats events from the resolved release as the old build, not a regression", () => {
		const resolved = {
			...base,
			previousStatus: "resolved" as const,
			resolvedRelease: "marky@1.0.0",
		};
		expect(evaluateRules(resolved)).toEqual({ reopen: false, alert: null });
		expect(evaluateRules({ ...resolved, eventRelease: "marky@1.0.1" })).toEqual(
			{
				reopen: true,
				alert: "issue.regressed",
			},
		);
		expect(evaluateRules({ ...resolved, eventRelease: null }).alert).toBe(
			"issue.regressed",
		);
	});

	it("reopens on a warning regression without alerting", () => {
		expect(
			evaluateRules({
				...base,
				previousStatus: "resolved",
				resolvedRelease: "marky@1.0.0",
				eventRelease: "marky@1.0.1",
				level: "warning",
			}),
		).toEqual({ reopen: true, alert: null });
	});

	it("fires the threshold once per window and respects ignore", () => {
		const spike = { ...base, windowCount: DEFAULT_RULES.thresholdCount };
		expect(evaluateRules(spike).alert).toBe("issue.threshold");
		expect(
			evaluateRules({ ...spike, lastAlertAt: base.now - 1000 }).alert,
		).toBe(null);
		expect(
			evaluateRules({
				...spike,
				lastAlertAt: base.now - DEFAULT_RULES.thresholdWindowMs,
			}).alert,
		).toBe("issue.threshold");
		expect(evaluateRules({ ...spike, previousStatus: "ignored" }).alert).toBe(
			null,
		);
	});
});
