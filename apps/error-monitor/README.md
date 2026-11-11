# Marky error monitor

A local, zero-dependency error monitor for Marky. It groups errors into issues,
shows them on a small dashboard, and sends signed alert webhooks that a Warp
factory can pick up as work. Everything runs on your machine: Node's built-in
SQLite, no accounts, no external services.

```
Marky (@marky/error-reporter) ──► ingest API ──► issues ──► alert rules ──► signed webhook ──► Warp factory
                                                    └──► dashboard (localhost:4747)
```

The monitor only makes outbound requests, so a factory in the cloud can receive
alerts from a monitor on your laptop without a tunnel.

## Quick start

Requires Node 22.13+ (the repo's `engines` range).

```sh
pnpm dev:error-monitor                            # dashboard on http://localhost:4747, prints the DSN
pnpm --filter @marky/error-monitor webhook:echo   # local receiver that verifies signatures
pnpm --filter @marky/error-monitor simulate       # send one of each sample error
```

The echo receiver registers itself as an endpoint the first time it runs. Run
it with `--fail 2` to watch the monitor retry with the same `webhook-id`.

`simulate` scenarios: `all` (default), `review-metadata`, `reply-timestamp`,
`preview-read` (a warning), and `spike`. Add `--release marky@0.2.0` to
pretend a newer build sent the event, or `--count N` to repeat it.

## Issues and alerts

Events are grouped by exception type plus the top three in-app stack frames
(file and function, ignoring line numbers and bundler content hashes). Errors
without frames group by their message with paths and numbers normalized.

Alerts fire for `error` and `fatal` events only. Warnings are recorded and
grouped but never alert.

- `issue.created`: the first event for a new issue.
- `issue.regressed`: an event on a resolved issue from a different release.
  Resolving records the issue's latest release, so late events from that same
  build don't reopen it.
- `issue.threshold`: at least `MONITOR_THRESHOLD_COUNT` events (default 10) in
  `MONITOR_THRESHOLD_WINDOW_MINUTES` (default 5). Any alert starts a cooldown of
  one window, so a spike right after `issue.created` doesn't alert twice. To demo
  a spike quickly, set the window to 1 minute, send one error, wait a minute,
  then run `simulate spike`.

A per-project cap (`MONITOR_DAILY_ALERT_CAP`, default 50 per rolling 24h)
suppresses further alerts so an error storm can't burn through factory runs.
Suppressed alerts still appear on the dashboard.

## Webhooks

Each endpoint uses one auth mode, matching a Warp factory webhook source's
`authMode`:

- `signature`: Standard Webhooks headers (`webhook-id`, `webhook-timestamp`,
  `webhook-signature`, HMAC-SHA256). Secrets look like `whsec_<base64>`.
- `token`: `Authorization: Bearer <secret>`.
- `none`: for URLs that carry their own token (`url_token`).

`webhook-id` is the alert id and stays the same across retries. Failed
deliveries retry after 5s, 30s, 2m, and 10m, then stop.

The payload is self-contained: alert `type`, `issue` (id, title, culprit,
count, first/last seen, release), the triggering `event` (exception, frames
innermost first, breadcrumbs, tags), and a `trigger` description. `issue.url`
is for humans on the machine running the monitor; cloud agents can't reach it.

## Connect a Warp factory

`examples/factory` is a minimal factory that receives these alerts:

- `webhooks/error-monitor.yaml`: a `standard_webhooks` signature source.
- `automations/triage-error/automation.md`: runs on `issue.*` alerts and skips
  dashboard test alerts.

1. Add a webhook endpoint for your factory's webhook URL on the dashboard's
   Webhooks page, with auth mode `signature`. Leave the secret blank to
   generate one.
2. Store that secret as a Warp managed secret named
   `ERROR_MONITOR_WEBHOOK_SECRET`.
3. Apply the factory, then replace the placeholder in the automation's
   `webhook_ids` with the UID the server assigned to the source.
4. Press "Send test" on the dashboard to check delivery and signatures.

You can also seed the endpoint at startup with `MONITOR_WEBHOOK_URL`,
`MONITOR_WEBHOOK_SECRET`, and `MONITOR_WEBHOOK_AUTH`.

## Running Marky with reporting

Marky reports only when `MARKY_ERROR_DSN` is set, so normal development is
unaffected:

```sh
MARKY_ERROR_DSN="<DSN from the monitor banner>" pnpm dev:desktop
```

- Main-process exceptions, renderer errors, unhandled rejections, renderer
  crashes, and errors caught by the document error boundary are all reported.
  Undelivered events wait in the app's userData folder until the monitor is up.
- The release is `marky@<package version>`. Set `MARKY_RELEASE=marky@0.2.0` to
  pretend a newer build is running, which is how you demo `issue.regressed`.
- Renderer frames are resolved through source maps at ingest (the Vite dev
  server's inline maps in dev, `.map` files next to built bundles otherwise), so
  issues show `packages/ui/src/...` paths and real function names. Maps are
  only read from localhost or from files under `MONITOR_SOURCE_ROOTS` (the
  monorepo root by default).

## Reporting from an app

```ts
import { initNodeReporter, forwardRendererEvents } from "@marky/error-reporter/node";

const reporter = initNodeReporter({ dsn: process.env.MARKY_ERROR_DSN!, release: "marky@0.1.0" });
forwardRendererEvents(ipcMain, reporter.client);
```

```ts
import { initRendererReporter, RENDERER_EVENT_CHANNEL } from "@marky/error-reporter/renderer";

initRendererReporter({ send: (event) => ipcRenderer.send(RENDERER_EVENT_CHANNEL, event) });
```

The API mirrors Sentry's (`captureException`, `captureMessage`,
`addBreadcrumb`, `setTag`, levels, a `handled` flag). The Node transport
batches events and keeps undelivered ones on disk when given a `queuePath`.

## Configuration

- `MONITOR_PORT` (4747), `MONITOR_HOST` (*********)
- `MONITOR_DB_PATH` (`apps/error-monitor/data/monitor.db`)
- `MONITOR_PUBLIC_URL`: base URL for dashboard links and the DSN
- `MONITOR_PROJECT_ID` (`marky`), `MONITOR_PROJECT_KEY`: pin the DSN key so app
  config survives a database reset
- `MONITOR_THRESHOLD_COUNT`, `MONITOR_THRESHOLD_WINDOW_MINUTES`, `MONITOR_DAILY_ALERT_CAP`

## API

- `POST /api/projects/:project/events` with `X-Monitor-Key` (or `?key=`): one
  event or `{ "events": [...] }`. Repeated `event_id`s are ignored.
- `GET /api/projects/:project/issues?status=unresolved|resolved|ignored|all`
  with the same key.
- `GET /api/health`
