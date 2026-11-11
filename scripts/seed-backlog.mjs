// Copies the course backlog into your copy of Marky as GitHub issues.
//
// The backlog lives as open issues labeled `course-backlog` on the template
// repo. A template copy does not bring issues with it, so this script recreates
// them in your repo, in order, through the GitHub CLI.
//
//   pnpm seed-backlog                     # into the repo in the current directory
//   pnpm seed-backlog --label factory     # and label each issue
//   pnpm seed-backlog --repo you/marky --dry-run
//
// Running it again skips issues whose title already exists in your repo.
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

const SOURCE_REPO = "warpdotdev-demos/warp-learn-markdown-app";
const SOURCE_LABEL = "course-backlog";
const ORDER_MARKER = /<!--\s*backlog-order:\s*(\d+)\s*-->\n?/;

const { values: options } = parseArgs({
	options: {
		repo: { type: "string" },
		label: { type: "string" },
		source: { type: "string", default: SOURCE_REPO },
		"dry-run": { type: "boolean", default: false },
		help: { type: "boolean", short: "h", default: false },
	},
});

if (options.help) {
	console.log(
		"Usage: pnpm seed-backlog [--label <name>] [--repo <owner/name>] [--dry-run]",
	);
	process.exit(0);
}

function gh(args, input) {
	const result = spawnSync("gh", args, { encoding: "utf8", input });
	if (result.error?.code === "ENOENT") {
		fail("The GitHub CLI (gh) is required: https://cli.github.com");
	}
	if (result.status !== 0) {
		fail(`gh ${args.join(" ")} failed:\n${result.stderr.trim()}`);
	}
	return result.stdout;
}

function fail(message) {
	console.error(message);
	process.exit(1);
}

const target =
	options.repo ??
	gh([
		"repo",
		"view",
		"--json",
		"nameWithOwner",
		"-q",
		".nameWithOwner",
	]).trim();

if (target.toLowerCase() === options.source.toLowerCase()) {
	fail(
		`${target} is the backlog source. Run this from your own copy, or pass --repo.`,
	);
}

const backlog = JSON.parse(
	gh([
		"issue",
		"list",
		"--repo",
		options.source,
		"--label",
		SOURCE_LABEL,
		"--state",
		"open",
		"--limit",
		"100",
		"--json",
		"title,body",
	]),
)
	.map((issue) => {
		const order = Number(issue.body.match(ORDER_MARKER)?.[1] ?? Infinity);
		return {
			order,
			title: issue.title,
			body: issue.body.replace(ORDER_MARKER, "").trim(),
		};
	})
	.sort((a, b) => a.order - b.order);

if (backlog.length === 0) {
	fail(`No open \`${SOURCE_LABEL}\` issues found on ${options.source}.`);
}

const existingTitles = new Set(
	JSON.parse(
		gh([
			"issue",
			"list",
			"--repo",
			target,
			"--state",
			"all",
			"--limit",
			"1000",
			"--json",
			"title",
		]),
	).map((issue) => issue.title),
);

if (options.label && !options["dry-run"]) {
	const labels = JSON.parse(
		gh([
			"label",
			"list",
			"--repo",
			target,
			"--limit",
			"1000",
			"--json",
			"name",
		]),
	);
	if (!labels.some((label) => label.name === options.label)) {
		gh(["label", "create", options.label, "--repo", target]);
		console.log(`Created label "${options.label}" in ${target}.`);
	}
}

console.log(
	`Seeding ${backlog.length} issues from ${options.source} into ${target}${
		options["dry-run"] ? " (dry run)" : ""
	}.`,
);

let created = 0;
for (const issue of backlog) {
	if (existingTitles.has(issue.title)) {
		console.log(`  skip    ${issue.title} (already exists)`);
		continue;
	}
	if (options["dry-run"]) {
		console.log(`  would create  ${issue.title}`);
		continue;
	}
	const args = [
		"issue",
		"create",
		"--repo",
		target,
		"--title",
		issue.title,
		"--body-file",
		"-",
	];
	if (options.label) args.push("--label", options.label);
	const url = gh(args, issue.body).trim();
	console.log(`  create  ${issue.title}\n          ${url}`);
	created++;
}

console.log(`Done: ${created} created.`);
