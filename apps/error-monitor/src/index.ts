import "./quietWarnings.js";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { openDb } from "./db.js";
import {
	createEndpoint,
	dsnFor,
	ensureProject,
	listEndpoints,
} from "./store.js";
import { createSymbolicator } from "./symbolicate.js";
import { startDeliveryWorker } from "./webhooks/delivery.js";

const config = loadConfig();
const db = openDb(config.dbPath);
const project = ensureProject(db, config.projectId, {
	name: "Marky",
	key: config.projectKey,
	now: Date.now(),
});

let seededSecret: string | null = null;
if (
	config.seedWebhook &&
	!listEndpoints(db, project.id).some(
		(endpoint) => endpoint.url === config.seedWebhook?.url,
	)
) {
	const endpoint = createEndpoint(db, {
		projectId: project.id,
		url: config.seedWebhook.url,
		authMode: config.seedWebhook.authMode,
		secret: config.seedWebhook.secret,
		now: Date.now(),
	});
	if (!config.seedWebhook.secret) seededSecret = endpoint.secret;
}

const app = createApp({
	db,
	config,
	symbolicator: createSymbolicator({ roots: config.sourceRoots }),
});
const worker = startDeliveryWorker(db);
const server = serve(
	{ fetch: app.fetch, port: config.port, hostname: config.host },
	() => {
		const dsn = dsnFor(project, config.publicUrl);
		console.log(`
Marky error monitor
  Dashboard  ${config.publicUrl}
  DSN        ${dsn}
  Database   ${config.dbPath}

Point Marky at it with MARKY_ERROR_DSN="${dsn}"`);
		if (seededSecret) {
			console.log(
				`\nCreated a webhook endpoint for ${config.seedWebhook?.url} with a generated secret.\nCopy it from the dashboard's Webhooks page into the matching Warp managed secret.`,
			);
		}
	},
);

function shutdown() {
	worker.stop();
	server.close();
	db.close();
	process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
