// Sends realistic Marky errors through @marky/error-reporter so the monitor can
// be demoed before the app itself is wired up.
//
//   pnpm --filter @marky/error-monitor simulate               one of each
//   pnpm --filter @marky/error-monitor simulate spike         a burst that trips issue.threshold
//   pnpm --filter @marky/error-monitor simulate review-metadata --release marky@0.2.0
//
// Uses MARKY_ERROR_DSN when set; otherwise reads the default project's DSN
// from the local monitor database.
import "../src/quietWarnings.js";
import { initNodeReporter } from "@marky/error-reporter/node";
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db.js";
import { dsnFor, getProject } from "../src/store.js";

type Scenario = {
	description: string;
	platform: "electron-main" | "electron-renderer";
	level: "error" | "warning";
	error: () => Error;
};

const MARKY = "/Applications/Marky.app/Contents/Resources/app.asar";

function withStack(error: Error, frames: string[]): Error {
	error.stack = [
		`${error.name}: ${error.message}`,
		...frames.map((f) => `    at ${f}`),
	].join("\n");
	return error;
}

const SCENARIOS: Record<string, Scenario> = {
	"review-metadata": {
		description: "Corrupt review comment metadata stops a note from opening",
		platform: "electron-renderer",
		level: "error",
		error: () =>
			withStack(new SyntaxError("Unexpected end of JSON input"), [
				"JSON.parse (<anonymous>)",
				`parseReviewMetadata (${MARKY}/packages/editor/src/ReviewMark.ts:57:22)`,
				`mergeReviewMetadata (${MARKY}/packages/editor/src/markdownToProsemirror.ts:515:19)`,
				`inlineToPM (${MARKY}/packages/editor/src/markdownToProsemirror.ts:411:9)`,
				`blockToPM (${MARKY}/packages/editor/src/markdownToProsemirror.ts:56:15)`,
				`markdownToTiptapDoc (${MARKY}/packages/editor/src/markdownToProsemirror.ts:28:55)`,
			]),
	},
	"reply-timestamp": {
		description:
			"Agent reply with a freeform timestamp throws when its thread opens",
		platform: "electron-renderer",
		level: "error",
		error: () =>
			withStack(new RangeError("Invalid time value"), [
				"Date.toISOString (<anonymous>)",
				`ReviewCommentPopover (${MARKY}/packages/ui/src/editor/ReviewCommentPopover.tsx:729:48)`,
				`renderWithHooks (${MARKY}/node_modules/react-dom/cjs/react-dom-client.production.js:5529:22)`,
				`updateFunctionComponent (${MARKY}/node_modules/react-dom/cjs/react-dom-client.production.js:7932:19)`,
			]),
	},
	"preview-read": {
		description: "Note preview read failed (handled, warning only)",
		platform: "electron-main",
		level: "warning",
		error: () =>
			withStack(
				new Error(
					"ENOENT: no such file or directory, open '/Users/learner/Notes/broken-link.md'",
				),
				[
					`readHead (${MARKY}/out/main/main.js:412:17)`,
					`readPreview (${MARKY}/out/main/main.js:398:20)`,
				],
			),
	},
};

const args = process.argv.slice(2);
const flag = (name: string) => {
	const index = args.indexOf(`--${name}`);
	return index === -1 ? undefined : args[index + 1];
};
const positional = args.filter(
	(arg, index) => !arg.startsWith("--") && !args[index - 1]?.startsWith("--"),
);
const scenarioName = positional[0] ?? "all";
const release = flag("release") ?? "marky@0.1.0";
const count = Number(flag("count") ?? (scenarioName === "spike" ? 12 : 1));

function resolveDsn(): string {
	if (process.env.MARKY_ERROR_DSN) return process.env.MARKY_ERROR_DSN;
	const config = loadConfig();
	const db = openDb(config.dbPath);
	const project = getProject(db, config.projectId);
	db.close();
	if (!project) {
		throw new Error(
			"No monitor project found. Start the monitor first (pnpm --filter @marky/error-monitor dev) or set MARKY_ERROR_DSN.",
		);
	}
	return dsnFor(project, config.publicUrl);
}

const selected =
	scenarioName === "all"
		? Object.keys(SCENARIOS)
		: scenarioName === "spike"
			? ["reply-timestamp"]
			: [scenarioName];
for (const name of selected) {
	if (!SCENARIOS[name]) {
		console.error(
			`Unknown scenario "${name}". Try: all, spike, ${Object.keys(SCENARIOS).join(", ")}`,
		);
		process.exit(1);
	}
}

const reporter = initNodeReporter({
	dsn: resolveDsn(),
	release,
	environment: "simulated",
	installHandlers: false,
	onTransportError: (error) =>
		console.error("Could not reach the monitor:", error),
});

for (const name of selected) {
	const scenario = SCENARIOS[name];
	if (!scenario) continue;
	for (let index = 0; index < count; index += 1) {
		reporter.client.addBreadcrumb({
			category: "navigation",
			message: "Opened note welcome.md",
		});
		reporter.client.captureException(scenario.error(), {
			level: scenario.level,
			handled: scenario.level === "warning",
			tags: { platform: scenario.platform, scenario: name },
		});
	}
	console.log(`Sent ${count} × ${name} (${release}): ${scenario.description}`);
}

const delivered = await reporter.flush(5000);
reporter.close();
if (!delivered) {
	console.error("Some events were not delivered. Is the monitor running?");
	process.exit(1);
}
