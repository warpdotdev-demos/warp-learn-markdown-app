import type { AlertWithDeliveries } from "../store.js";
import type { EndpointRow, ProjectRow } from "../types.js";
import { AlertsTable } from "./alerts.js";
import { Badge, Layout } from "./layout.js";

export function WebhooksPage(props: {
	project: ProjectRow;
	endpoints: EndpointRow[];
	alerts: AlertWithDeliveries[];
	dsn: string;
	now: number;
}) {
	const { project, endpoints } = props;
	return (
		<Layout title="Webhooks" project={project} active="webhooks">
			<h1>Webhooks &amp; alerts</h1>

			<h2>Endpoints</h2>
			<div class="card">
				{endpoints.length === 0 ? (
					<div class="empty">
						No endpoints. Add your Warp factory's webhook URL below, or run{" "}
						<code>pnpm --filter @marky/error-monitor webhook:echo</code> for a
						local receiver.
					</div>
				) : (
					<table class="middle">
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
											<div class="row" style="gap:8px;flex-wrap:nowrap">
												<span class="mono muted" aria-hidden="true">
													••••••••
												</span>
												<button
													type="button"
													class="copy"
													data-copy={endpoint.secret}
													aria-label="Copy secret"
													title="Copy secret"
												>
													<Icon class="idle">
														<rect
															width="14"
															height="14"
															x="8"
															y="8"
															rx="2"
															ry="2"
														/>
														<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
													</Icon>
													<Icon class="ok">
														<path d="M20 6 9 17l-5-5" />
													</Icon>
													<Icon class="fail">
														<path d="M18 6 6 18" />
														<path d="m6 6 12 12" />
													</Icon>
												</button>
											</div>
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

/** Lucide icon frame (https://lucide.dev); children are the icon's paths. */
function Icon(props: { class: string; children: unknown }) {
	return (
		<svg
			class={props.class}
			xmlns="http://www.w3.org/2000/svg"
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			{props.children}
		</svg>
	);
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
