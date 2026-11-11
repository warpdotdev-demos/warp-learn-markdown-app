// A local stand-in for a Warp factory webhook source. Verifies Standard
// Webhooks signatures and prints each alert.
//
//   pnpm --filter @marky/error-monitor webhook:echo            registers itself with the monitor
//   pnpm --filter @marky/error-monitor webhook:echo --fail 2   answer 500 twice to watch retries
//
// Pass --secret (or WEBHOOK_SECRET) to verify against a secret you manage
// yourself instead of registering an endpoint in the local monitor database.
import "../src/quietWarnings.js";
import { createServer } from "node:http";
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db.js";
import type { AlertPayload } from "../src/payload.js";
import { createEndpoint, getProject, listEndpoints } from "../src/store.js";
import { verifyPayload } from "../src/webhooks/sign.js";

const args = process.argv.slice(2);
const flag = (name: string) => {
	const index = args.indexOf(`--${name}`);
	return index === -1 ? undefined : args[index + 1];
};
const port = Number(flag("port") ?? process.env.ECHO_PORT ?? 4748);
const url = `http://localhost:${port}/`;
let failuresLeft = Number(flag("fail") ?? 0);

function registeredSecret(): string {
	const config = loadConfig();
	const db = openDb(config.dbPath);
	try {
		const project = getProject(db, config.projectId);
		if (!project) {
			throw new Error(
				"Start the monitor once first so it can create its project.",
			);
		}
		const existing = listEndpoints(db, project.id).find(
			(endpoint) => endpoint.url === url && endpoint.auth_mode === "signature",
		);
		const endpoint =
			existing ??
			createEndpoint(db, {
				projectId: project.id,
				url,
				authMode: "signature",
				now: Date.now(),
			});
		if (!existing)
			console.log(`Registered ${url} as a webhook endpoint in the monitor.`);
		return endpoint.secret ?? "";
	} finally {
		db.close();
	}
}

const secret =
	flag("secret") ?? process.env.WEBHOOK_SECRET ?? registeredSecret();

const server = createServer((request, response) => {
	const chunks: Buffer[] = [];
	request.on("data", (chunk: Buffer) => chunks.push(chunk));
	request.on("end", () => {
		const body = Buffer.concat(chunks).toString("utf8");
		const header = (name: string) => {
			const value = request.headers[name];
			return Array.isArray(value) ? value[0] : value;
		};
		const verification = verifyPayload(
			secret,
			{
				id: header("webhook-id"),
				timestamp: header("webhook-timestamp"),
				signature: header("webhook-signature"),
			},
			body,
		);
		const stamp = new Date().toLocaleTimeString();
		if (!verification.ok) {
			console.log(`\n${stamp}  ✗ rejected: ${verification.reason}`);
			response.writeHead(401).end(verification.reason);
			return;
		}
		if (failuresLeft > 0) {
			failuresLeft -= 1;
			console.log(
				`\n${stamp}  ↻ verified ${header("webhook-id")}, answering 500 to exercise retries`,
			);
			response.writeHead(500).end("simulated failure");
			return;
		}
		const alert = JSON.parse(body) as AlertPayload;
		console.log(`\n${stamp}  ✓ ${alert.type}  ${header("webhook-id")}`);
		if (alert.issue) {
			console.log(`  ${alert.issue.id}  ${alert.issue.title}`);
			console.log(
				`  culprit ${alert.issue.culprit ?? "?"} · ${alert.issue.count} events · ${alert.issue.release ?? "no release"}`,
			);
		}
		console.log(`  ${alert.trigger.description}`);
		response
			.writeHead(200, { "content-type": "application/json" })
			.end('{"ok":true}');
	});
});

server.listen(port, "127.0.0.1", () => {
	console.log(
		`Listening on ${url} and verifying Standard Webhooks signatures.`,
	);
});
