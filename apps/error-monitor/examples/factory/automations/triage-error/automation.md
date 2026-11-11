---
displayName: Triage error monitor alert
triggers:
  - provider: webhook
    event: received
    filter:
      # Replace with the UID the server assigns to webhooks/error-monitor.yaml.
      webhook_ids: [wh_replace_with_assigned_uid]
      payload:
        type: [issue.created, issue.regressed, issue.threshold]
---
An error monitor alert for Marky triggered this run. The payload is the alert:
`type`, `issue` (title, culprit, count, release), and `event` (exception, stack
frames innermost first, breadcrumbs, tags). `issue.url` may point to an unreachable
localhost URL for testing purposes, which is expected.

1. Find the code in the top in-app stack frame and reproduce the failure with a
   failing test. If you can't reproduce, say so and complete the run.
2. When reproduced, fix the root cause. If the input that triggered it is bad data,
   the app should degrade gracefully instead of crashing.
3. Open a pull request whose description includes `Fixes <issue.id>` and the
   alert type, so the fix can be matched to the monitor issue.
