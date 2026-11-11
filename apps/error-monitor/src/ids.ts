import { randomBytes } from "node:crypto";

export function randomId(prefix: string, bytes = 12): string {
	return `${prefix}_${randomBytes(bytes).toString("base64url")}`;
}

export function randomHex(bytes = 16): string {
	return randomBytes(bytes).toString("hex");
}

export function issuePublicId(id: number): string {
	return `iss_${id}`;
}
