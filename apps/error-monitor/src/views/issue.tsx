import type { IncomingEvent } from "../eventSchema.js";
import type { AlertWithDeliveries } from "../store.js";
import type { EventRow, IssueRow, ProjectRow } from "../types.js";
import { AlertsTable } from "./alerts.js";
import { Badge, IssueMenu, Layout, Time } from "./layout.js";

export function IssuePage(props: {
	project: ProjectRow;
	issue: IssueRow;
	events: EventRow[];
	alerts: AlertWithDeliveries[];
	now: number;
}) {
	const { project, issue, events, alerts, now } = props;
	const latest = events[0]
		? (JSON.parse(events[0].payload) as IncomingEvent)
		: null;
	const frames = latest?.exception?.stacktrace?.frames ?? [];
	return (
		<Layout title={issue.title} project={project} active="issues">
			<div class="row spread">
				<div>
					<div class="row">
						<Badge kind={issue.level} />
						<Badge kind={issue.status} />
						<span class="muted mono">iss_{issue.id}</span>
					</div>
					<h1 style="margin-top:6px">{issue.title}</h1>
					{issue.culprit && <div class="muted mono">{issue.culprit}</div>}
				</div>
				<div class="row">
					{issue.status !== "resolved" && (
						<StatusButton
							id={issue.id}
							status="resolved"
							label="Resolve"
							primary
						/>
					)}
					{issue.status !== "ignored" && (
						<StatusButton id={issue.id} status="ignored" label="Ignore" />
					)}
					{issue.status !== "unresolved" && (
						<StatusButton id={issue.id} status="unresolved" label="Reopen" />
					)}
					<IssueMenu id={issue.id} />
				</div>
			</div>

			<div class="card pad" style="margin-top:16px">
				<dl class="kv">
					<dt>Events</dt>
					<dd>{issue.event_count}</dd>
					<dt>First seen</dt>
					<dd>
						<Time ms={issue.first_seen} now={now} />
					</dd>
					<dt>Last seen</dt>
					<dd>
						<Time ms={issue.last_seen} now={now} />
					</dd>
					<dt>Latest release</dt>
					<dd class="mono">{issue.last_release ?? "unknown"}</dd>
					{issue.status === "resolved" && (
						<>
							<dt>Resolved in</dt>
							<dd class="mono">
								{issue.resolved_release ?? "unknown release"}{" "}
								<span class="muted">
									(events from this release won't reopen it)
								</span>
							</dd>
						</>
					)}
					<dt>Fingerprint</dt>
					<dd class="mono">{issue.fingerprint}</dd>
				</dl>
			</div>

			{latest && (
				<>
					<h2>Latest event</h2>
					<div class="card pad">
						<div class="row muted" style="margin-bottom:10px">
							<span class="mono">{latest.platform}</span>
							{latest.environment && <span>{latest.environment}</span>}
							{latest.release && <span class="mono">{latest.release}</span>}
							<span>{latest.handled ? "handled" : "unhandled"}</span>
							{Object.entries(latest.tags ?? {}).map(([key, value]) => (
								<code>
									{key}={value}
								</code>
							))}
						</div>
						{latest.exception ? (
							<>
								<div class="mono" style="margin-bottom:8px">
									<strong>{latest.exception.type}</strong>:{" "}
									{latest.exception.value}
								</div>
								{frames.length > 0 ? (
									<pre>
										{frames
											.map(
												(frame) =>
													`${frame.in_app ? "  " : "· "}at ${frame.function} (${frame.filename}${frame.lineno ? `:${frame.lineno}` : ""}${frame.colno ? `:${frame.colno}` : ""})`,
											)
											.join("\n")}
									</pre>
								) : (
									<div class="muted">No stack trace.</div>
								)}
							</>
						) : (
							<pre>{latest.message}</pre>
						)}
						{latest.breadcrumbs && latest.breadcrumbs.length > 0 && (
							<details style="margin-top:12px">
								<summary>Breadcrumbs ({latest.breadcrumbs.length})</summary>
								<table style="margin-top:8px">
									<tbody>
										{latest.breadcrumbs.map((crumb) => (
											<tr>
												<td class="mono muted">{crumb.timestamp}</td>
												<td class="mono">{crumb.category ?? ""}</td>
												<td>{crumb.message}</td>
											</tr>
										))}
									</tbody>
								</table>
							</details>
						)}
					</div>
				</>
			)}

			<h2>Alerts</h2>
			<AlertsTable alerts={alerts} now={now} showIssue={false} />

			<h2>Recent events</h2>
			<div class="card">
				<table>
					<thead>
						<tr>
							<th>Received</th>
							<th>Level</th>
							<th>Release</th>
							<th>Platform</th>
							<th>Event id</th>
						</tr>
					</thead>
					<tbody>
						{events.map((event) => (
							<tr>
								<td>
									<Time ms={event.received_at} now={now} />
								</td>
								<td>
									<Badge kind={event.level} />
								</td>
								<td class="mono">{event.release ?? "—"}</td>
								<td class="mono">{event.platform ?? "—"}</td>
								<td class="mono muted">{event.id}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</Layout>
	);
}

function StatusButton(props: {
	id: number;
	status: string;
	label: string;
	primary?: boolean;
}) {
	return (
		<form class="inline" method="post" action={`/issues/${props.id}/status`}>
			<input type="hidden" name="status" value={props.status} />
			<button class={props.primary ? "primary" : ""} type="submit">
				{props.label}
			</button>
		</form>
	);
}
