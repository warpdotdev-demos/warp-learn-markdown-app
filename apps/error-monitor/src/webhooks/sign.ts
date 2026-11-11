import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Standard Webhooks (https://www.standardwebhooks.com): HMAC-SHA256 over
// `${id}.${timestamp}.${body}`, keyed by the base64 secret after `whsec_`.
// Warp factory webhook sources verify this with `signatureScheme: standard_webhooks`.

const DEFAULT_TOLERANCE_SECONDS = 5 * 60;

export function generateSecret(): string {
	return `whsec_${randomBytes(24).toString("base64")}`;
}

function secretKey(secret: string): Buffer {
	return Buffer.from(
		secret.startsWith("whsec_") ? secret.slice(6) : secret,
		"base64",
	);
}

export function signPayload(
	secret: string,
	id: string,
	timestampSeconds: number,
	body: string,
): string {
	const digest = createHmac("sha256", secretKey(secret))
		.update(`${id}.${timestampSeconds}.${body}`)
		.digest("base64");
	return `v1,${digest}`;
}

export type SignatureHeaders = {
	id: string | null | undefined;
	timestamp: string | null | undefined;
	signature: string | null | undefined;
};

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export function verifyPayload(
	secret: string,
	headers: SignatureHeaders,
	body: string,
	options: { toleranceSeconds?: number; now?: number } = {},
): VerifyResult {
	const { id, timestamp, signature } = headers;
	if (!id || !timestamp || !signature) {
		return {
			ok: false,
			reason: "missing webhook-id, webhook-timestamp, or webhook-signature",
		};
	}
	const timestampSeconds = Number(timestamp);
	if (!Number.isInteger(timestampSeconds)) {
		return { ok: false, reason: "webhook-timestamp is not an integer" };
	}
	const nowSeconds = Math.floor((options.now ?? Date.now()) / 1000);
	const skew = Math.abs(nowSeconds - timestampSeconds);
	if (skew > (options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS)) {
		return {
			ok: false,
			reason: `timestamp is ${skew}s from now (clock skew?)`,
		};
	}
	const expected = Buffer.from(
		signPayload(secret, id, timestampSeconds, body).slice(3),
	);
	// The header may carry several space-separated signatures during key rotation.
	for (const candidate of signature.split(" ")) {
		const [version, value] = candidate.split(",");
		if (version !== "v1" || !value) continue;
		const actual = Buffer.from(value);
		if (
			actual.length === expected.length &&
			timingSafeEqual(actual, expected)
		) {
			return { ok: true };
		}
	}
	return { ok: false, reason: "no matching v1 signature" };
}
