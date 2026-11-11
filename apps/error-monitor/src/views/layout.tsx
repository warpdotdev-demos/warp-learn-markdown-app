import { raw } from "hono/html";
import type { PropsWithChildren } from "hono/jsx";
import type { ProjectRow } from "../types.js";

const STYLES = `
:root {
	color-scheme: light dark;
	--bg: #fbfbfb; --fg: #202223; --card: #ffffff; --sunken: #eceeee;
	--muted: #646768; --line: #e1e3e4; --accent: #1008ff;
	--err: #b42335; --warn: #1008ff; --ok: #1b7f45; --info: #2e5ea8;
	--mono: ui-monospace, "SF Mono", Menlo, monospace;
}
@media (prefers-color-scheme: dark) {
	:root {
		--bg: #1b1c1c; --fg: #ebeded; --card: #242526; --sunken: #2c2d2e;
		--muted: #a7aaab; --line: rgb(255 255 255 / 10%); --accent: #8a86ff;
		--err: #ff8592; --warn: #8a86ff; --ok: #6ee3a3; --info: #8db4ff;
	}
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif; }
a { color: inherit; }
header.top { display: flex; align-items: center; gap: 24px; padding: 12px 24px; border-bottom: 1px solid var(--line); background: var(--card); }
header.top .brand { font-weight: 650; text-decoration: none; }
header.top nav { display: flex; gap: 16px; }
header.top nav a { color: var(--muted); text-decoration: none; padding: 4px 0; }
header.top nav a.on { color: var(--fg); border-bottom: 2px solid var(--accent); }
main { max-width: 1100px; margin: 0 auto; padding: 24px; }
h1 { font-size: 20px; margin: 0 0 4px; }
h2 { font-size: 15px; font-weight: 600; margin: 28px 0 10px; }
.muted { color: var(--muted); }
.mono, code, pre { font-family: var(--mono); font-size: 12.5px; }
code { background: var(--sunken); padding: 1px 5px; border-radius: 4px; }
pre { background: var(--sunken); border: 1px solid var(--line); border-radius: 8px; padding: 12px; overflow-x: auto; margin: 0; }
/* Inside a table cell, overflow can't scroll; the cell would grow and push the
   other columns. Wrap instead, breaking long tokens like URLs anywhere. */
pre.wrap { white-space: pre-wrap; overflow-wrap: anywhere; overflow-y: auto; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; }
.pad { padding: 16px; }
.row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.spread { justify-content: space-between; }
.tabs { display: flex; gap: 6px; margin: 16px 0 12px; }
.tabs a { text-decoration: none; padding: 4px 10px; border-radius: 6px; color: var(--muted); border: 1px solid transparent; }
.tabs a.on { color: var(--fg); background: var(--card); border-color: var(--line); }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; font-weight: 500; color: var(--muted); padding: 8px 12px; border-bottom: 1px solid var(--line); font-size: 12px; }
td { padding: 10px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
table.middle td { vertical-align: middle; }
tr:last-child td { border-bottom: none; }
.title { font-weight: 600; text-decoration: none; word-break: break-word; }
.badge { display: inline-block; font: 600 11px var(--mono); padding: 1px 7px; border-radius: 4px; white-space: nowrap; }
.b-error, .b-fatal, .b-failed, .b-unresolved { color: var(--err); background: color-mix(in oklab, var(--err) 13%, transparent); }
.b-warning, .b-pending, .b-ignored, .b-suppressed { color: var(--warn); background: color-mix(in oklab, var(--warn) 15%, transparent); }
.b-success, .b-resolved { color: var(--ok); background: color-mix(in oklab, var(--ok) 13%, transparent); }
.b-info, .b-test { color: var(--info); background: color-mix(in oklab, var(--info) 13%, transparent); }
.spark { display: inline-flex; gap: 1px; align-items: flex-end; height: 20px; }
.spark i { display: block; width: 3px; background: var(--accent); border-radius: 1px; min-height: 1px; opacity: .85; }
button, .button { font: inherit; padding: 5px 12px; border-radius: 6px; border: 1px solid var(--line); background: var(--card); color: var(--fg); cursor: pointer; }
button.primary { background: var(--accent); color: var(--bg); border-color: transparent; }
button.danger { color: var(--err); }
input, select { font: inherit; padding: 5px 8px; border-radius: 6px; border: 1px solid var(--line); background: var(--bg); color: var(--fg); }
/* Native select arrows ignore padding and sit flush with the border; draw our own. */
select { appearance: none; padding-right: 30px; background: var(--bg) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%238a8d8e' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat right 10px center; }
form.inline { display: inline; }
/* All icons share one grid cell so swapping them never changes the button's size. */
button.copy { display: inline-grid; place-items: center; padding: 4px; border: none; background: none; color: var(--muted); }
button.copy:hover { color: var(--fg); background: var(--sunken); }
button.copy.ok { color: var(--ok); }
button.copy.fail { color: var(--err); }
button.copy > svg { grid-area: 1 / 1; visibility: hidden; }
button.copy .idle, button.copy.ok .ok, button.copy.fail .fail { visibility: visible; }
button.copy.ok .idle, button.copy.fail .idle { visibility: hidden; }
.frame-lib { opacity: .55; }
details summary { cursor: pointer; }
.empty { padding: 40px; text-align: center; color: var(--muted); }
.kv { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; }
.kv dt { color: var(--muted); }
.kv dd { margin: 0; }
details.menu { position: relative; display: inline-block; }
/* Same box as button so it lines up with Resolve/Ignore. */
details.menu > summary { list-style: none; display: inline-flex; align-items: center; justify-content: center; padding: 5px 10px; line-height: 1.5; border-radius: 6px; border: 1px solid var(--line); background: var(--card); color: var(--muted); font-weight: 700; }
details.menu > summary::-webkit-details-marker { display: none; }
details.menu > summary:hover, details.menu[open] > summary { background: var(--sunken); border-color: var(--line); color: var(--fg); }
.menu-items { position: absolute; right: 0; top: calc(100% + 4px); z-index: 10; min-width: 160px; padding: 4px; background: var(--card); border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 8px 24px rgb(0 0 0 / 15%); }
.menu-items form { margin: 0; }
.menu-items button { width: 100%; text-align: left; border: none; background: none; padding: 6px 10px; }
.menu-items button:hover { background: var(--sunken); }
`;

// Confirms forms marked with data-confirm, copies data-copy values to the
// clipboard, and closes overflow menus on an outside click or Escape. Native
// <details> handles opening.
const SCRIPT = `
document.addEventListener("click", async (event) => {
	const button = event.target.closest && event.target.closest("button[data-copy]");
	if (!button) return;
	let state = "ok";
	try {
		await navigator.clipboard.writeText(button.dataset.copy);
	} catch {
		state = "fail";
	}
	button.classList.remove("ok", "fail");
	button.classList.add(state);
	clearTimeout(button.copyTimer);
	button.copyTimer = setTimeout(() => button.classList.remove(state), 1500);
});
document.addEventListener("submit", (event) => {
	const message = event.target.dataset && event.target.dataset.confirm;
	if (message && !confirm(message)) event.preventDefault();
});
const closeMenus = (except) => {
	for (const menu of document.querySelectorAll("details.menu[open]")) {
		if (menu !== except) menu.open = false;
	}
};
document.addEventListener("click", (event) => {
	closeMenus(event.target.closest && event.target.closest("details.menu"));
});
document.addEventListener("keydown", (event) => {
	if (event.key === "Escape") closeMenus(null);
});
`;

export type LayoutProps = PropsWithChildren<{
	title: string;
	project?: ProjectRow;
	active?: "issues" | "webhooks";
}>;

export function Layout({ title, project, active, children }: LayoutProps) {
	// Without a doctype the page renders in quirks mode (forms get a bottom
	// margin, tables stop inheriting font size).
	return (
		<>
			{raw("<!doctype html>")}
			<html lang="en">
				<head>
					<meta charset="utf-8" />
					<meta name="viewport" content="width=device-width, initial-scale=1" />
					<title>{title} · Marky error monitor</title>
					<style>{raw(STYLES)}</style>
				</head>
				<body>
					<header class="top">
						<a class="brand" href="/">
							Marky error monitor
						</a>
						{project && (
							<nav>
								<a
									class={active === "issues" ? "on" : ""}
									href={`/projects/${project.id}/issues`}
								>
									Issues
								</a>
								<a
									class={active === "webhooks" ? "on" : ""}
									href={`/projects/${project.id}/webhooks`}
								>
									Webhooks &amp; alerts
								</a>
							</nav>
						)}
					</header>
					<main>{children}</main>
					<script>{raw(SCRIPT)}</script>
				</body>
			</html>
		</>
	);
}

export function ago(ms: number, now: number): string {
	const seconds = Math.max(0, Math.round((now - ms) / 1000));
	if (seconds < 60) return `${seconds}s ago`;
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 48) return `${hours}h ago`;
	return `${Math.round(hours / 24)}d ago`;
}

export function Time({ ms, now }: { ms: number; now: number }) {
	const iso = new Date(ms).toISOString();
	return (
		<time datetime={iso} title={iso}>
			{ago(ms, now)}
		</time>
	);
}

export function Badge({ kind, label }: { kind: string; label?: string }) {
	return <span class={`badge b-${kind}`}>{label ?? kind}</span>;
}

/** Overflow menu for one issue. Deleting keeps the alert history. */
export function IssueMenu({ id }: { id: number }) {
	return (
		<details class="menu">
			<summary aria-label="More actions" title="More actions">
				⋮
			</summary>
			<div class="menu-items">
				<form
					method="post"
					action={`/issues/${id}/delete`}
					data-confirm={`Delete iss_${id} and its events? Alert history is kept, and the next occurrence opens a new issue.`}
				>
					<button class="danger" type="submit">
						Delete issue
					</button>
				</form>
			</div>
		</details>
	);
}

export function Spark({ counts }: { counts: number[] }) {
	const max = Math.max(1, ...counts);
	return (
		<span class="spark" title="Events per hour, last 24h">
			{counts.map((count) => (
				<i style={`height:${Math.round((count / max) * 20)}px`} />
			))}
		</span>
	);
}
