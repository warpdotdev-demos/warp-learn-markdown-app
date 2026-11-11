import type { AlertWithDeliveries } from "../store.js";
import type { EndpointRow, ProjectRow, RuleConfig } from "../types.js";
import { AlertsTable } from "./alerts.js";
import { Badge, Layout } from "./layout.js";

export function WebhooksPage(props: {
	project: ProjectRow;
	endpoints: EndpointRow[];
	alerts: AlertWithDeliveries[];
	alertsToday: number;
	rules: RuleConfig;
	dsn: string;
	now: number;
}) {
	const { project, endpoints, rules } = props;
	const windowMinutes = Math.round(rules.thresholdWindowMs / 60_000);
	return (
		<Layout title="Webhooks" project={project} active="webhooks">
			<h1>Webhooks &amp; alerts</h1>
			<p class="muted">
				Alerts fire for <code>error</code> and <code>fatal</code> events only: a
				new issue, a regression in a newer release, or {rules.thresholdCount}+
				events in {windowMinutes} minutes. {props.alertsToday} of{" "}
				{rules.dailyAlertCap} alerts used in the last 24h.
			</p>

			<h2>Endpoints</h2>
			<div class="card">
				{endpoints.length === 0 ? (
					<div class="empty">
						No endpoints. Add your Warp factory's webhook URL below, or run{" "}
						<code>pnpm --filter @marky/error-monitor webhook:echo</code> for a
						local receiver.
					</div>
				) : (
					<table>
						<thead>
							<tr>
								<th>URL</th>
								<th>Auth</th>
								<th>Secret</th>
								<th />
							</tr>
						</thead>
						<tbody>
							{endpoints.map((endpoint) => (
								<tr>
									<td class="mono" style="word-break:break-all">
										{endpoint.url}
										{endpoint.enabled === 0 && (
											<>
												{" "}
												<Badge kind="ignored" label="disabled" />
											</>
										)}
									</td>
									<td class="mono">{authLabel(endpoint)}</td>
									<td>
										{endpoint.secret ? (
											<details>
												<summary class="muted">reveal</summary>
												<code style="word-break:break-all">
													{endpoint.secret}
												</code>
											</details>
										) : (
											<span class="muted">—</span>
										)}
									</td>
									<td>
										<div class="row" style="gap:6px;justify-content:flex-end">
											<PostButton
												action={`/webhooks/${endpoint.id}/test`}
												label="Send test"
											/>
											<PostButton
												action={`/webhooks/${endpoint.id}/toggle`}
												label={endpoint.enabled ? "Disable" : "Enable"}
											/>
											<PostButton
												action={`/webhooks/${endpoint.id}/delete`}
												label="Delete"
												danger
											/>
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</div>

			<form
				class="card pad row"
				style="margin-top:12px"
				method="post"
				action={`/projects/${project.id}/webhooks`}
			>
				<input
					name="url"
					type="url"
					required
					placeholder="https://… factory webhook URL"
					style="flex:1;min-width:280px"
				/>
				<select name="auth_mode">
					<option value="token" selected>
						token (Bearer)
					</option>
					<option value="signature">signature (Standard Webhooks)</option>
					<option value="none">none</option>
				</select>
				<input
					name="secret"
					placeholder="secret (blank = generate)"
					style="min-width:220px"
				/>
				<button class="primary" type="submit">
					Add endpoint
				</button>
			</form>
			<p class="muted">
				Token mode sends <code>{"Authorization: Bearer <secret>"}</code>, for a
				Warp factory webhook with Bearer token auth. Paste the factory's token
				as the secret. Signature mode signs with <code>webhook-id</code>,{" "}
				<code>webhook-timestamp</code>, and <code>webhook-signature</code>, so a
				Warp factory webhook source with{" "}
				<code>signatureScheme: standard_webhooks</code> can verify it. Store the
				same secret as the managed secret named by the source's{" "}
				<code>secretName</code>.
			</p>

			<h2>Recent alerts</h2>
			<AlertsTable alerts={props.alerts} now={props.now} showIssue />
		</Layout>
	);
}

function authLabel(endpoint: EndpointRow) {
	if (endpoint.auth_mode === "signature") return "standard_webhooks";
	if (endpoint.auth_mode === "token") return "bearer token";
	return "none";
}

function PostButton(props: {
	action: string;
	label: string;
	danger?: boolean;
}) {
	return (
		<form class="inline" method="post" action={props.action}>
			<button class={props.danger ? "danger" : ""} type="submit">
				{props.label}
			</button>
		</form>
	);
}
