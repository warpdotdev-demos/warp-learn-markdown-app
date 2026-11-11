import type { IssueRow, IssueStatus, ProjectRow } from "../types.js";
import { Badge, IssueMenu, Layout, Spark, Time } from "./layout.js";

const TABS: (IssueStatus | "all")[] = [
	"unresolved",
	"resolved",
	"ignored",
	"all",
];

export function IssuesPage(props: {
	project: ProjectRow;
	issues: IssueRow[];
	counts: Record<IssueStatus, number>;
	status: IssueStatus | "all";
	sparks: Map<number, number[]>;
	dsn: string;
	now: number;
}) {
	const { project, issues, counts, status, sparks, now } = props;
	return (
		<Layout title="Issues" project={project} active="issues">
			<div class="row spread">
				<div>
					<h1>{project.name}</h1>
					<div class="muted">
						DSN <code>{props.dsn}</code>
					</div>
				</div>
			</div>
			<div class="tabs">
				{TABS.map((tab) => (
					<a
						class={tab === status ? "on" : ""}
						href={`/projects/${project.id}/issues?status=${tab}`}
					>
						{tab}
						{tab !== "all" && <span class="muted"> {counts[tab]}</span>}
					</a>
				))}
			</div>
			<div class="card">
				{issues.length === 0 ? (
					<div class="empty">
						No {status === "all" ? "" : status} issues yet. Run{" "}
						<code>pnpm --filter @marky/error-monitor simulate</code> to send
						sample errors.
					</div>
				) : (
					<table>
						<thead>
							<tr>
								<th>Issue</th>
								<th>Last 24h</th>
								<th>Events</th>
								<th>Last seen</th>
								<th>Status</th>
								<th aria-label="Actions" />
							</tr>
						</thead>
						<tbody>
							{issues.map((issue) => (
								<tr>
									<td>
										<div class="row">
											<Badge kind={issue.level} />
											<a class="title" href={`/issues/${issue.id}`}>
												{issue.title}
											</a>
										</div>
										<div class="muted mono">
											iss_{issue.id}
											{issue.culprit && ` · ${issue.culprit}`}
											{issue.last_release && ` · ${issue.last_release}`}
										</div>
									</td>
									<td>
										<Spark counts={sparks.get(issue.id) ?? []} />
									</td>
									<td>{issue.event_count}</td>
									<td>
										<Time ms={issue.last_seen} now={now} />
									</td>
									<td>
										<Badge kind={issue.status} />
									</td>
									<td style="text-align:right">
										<IssueMenu id={issue.id} />
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</div>
		</Layout>
	);
}
