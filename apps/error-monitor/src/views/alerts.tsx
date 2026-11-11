import type { AlertWithDeliveries } from "../store.js";
import { Badge, Time } from "./layout.js";

export function AlertsTable(props: {
	alerts: AlertWithDeliveries[];
	now: number;
	showIssue: boolean;
}) {
	const { alerts, now } = props;
	if (alerts.length === 0) {
		return <div class="card empty">No alerts yet.</div>;
	}
	return (
		<div class="card">
			<table>
				<thead>
					<tr>
						<th>Alert</th>
						{props.showIssue && <th>Issue</th>}
						<th>Created</th>
						<th>Deliveries</th>
					</tr>
				</thead>
				<tbody>
					{alerts.map((alert) => (
						<tr>
							<td>
								<div class="row">
									<Badge
										kind={alert.type === "test" ? "test" : "info"}
										label={alert.type}
									/>
									{alert.suppressed === 1 && (
										<Badge kind="suppressed" label="suppressed: daily cap" />
									)}
								</div>
								<details style="margin-top:6px">
									<summary class="muted mono">{alert.id}</summary>
									<pre class="wrap" style="margin-top:6px;max-height:320px">
										{JSON.stringify(JSON.parse(alert.payload), null, 2)}
									</pre>
								</details>
							</td>
							{props.showIssue && (
								<td>
									{alert.issue_id ? (
										<a class="mono" href={`/issues/${alert.issue_id}`}>
											iss_{alert.issue_id}
										</a>
									) : (
										<span class="muted">—</span>
									)}
								</td>
							)}
							<td>
								<Time ms={alert.created_at} now={now} />
							</td>
							<td>
								{alert.deliveries.length === 0 ? (
									<span class="muted">
										{alert.suppressed ? "not sent" : "no endpoints"}
									</span>
								) : (
									alert.deliveries.map((delivery) => (
										<div class="row" style="gap:6px">
											<Badge kind={delivery.status} />
											<span class="mono muted">
												{delivery.attempts} attempt
												{delivery.attempts === 1 ? "" : "s"}
												{delivery.response_status !== null &&
													` · HTTP ${delivery.response_status}`}
											</span>
											{delivery.error && (
												<span class="mono" title={delivery.error}>
													{delivery.error.slice(0, 60)}
												</span>
											)}
										</div>
									))
								)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
