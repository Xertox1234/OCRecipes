---
title: "iOS E2E: CI Postgres saturates, requests take 10-16 s and time out"
status: backlog
priority: medium
created: 2026-11-10
updated: 2026-11-10
assignee:
labels: [deferred, e2e]
github_issue:
---

# iOS E2E: CI Postgres saturates, requests take 10-16 s and time out

## Summary

In iOS E2E run 42810549290, the server's requests took 10-16 s around 12:52 and 13:13, and some database reads failed with "Connection terminated due to connection timeout". Flows that land in those windows fail.

## Background

Deferred from the receipt-flakiness investigation (2026-11-10). #1825 stopped the worst symptom: `requireAuth` used to turn the failed tokenVersion read into a 401, which signed the user out. Now it answers 500. The slowness itself is still there, so a flow that lands in a slow window can still fail on a 500.

Evidence: logs-ios artifact of run 42810549290, server.log:

- `POST /api/auth/login` took 16439 ms.
- `GET /api/subscription/status` returned 500 after 10354 ms ("Failed query … Connection terminated due to connection timeout").
- `GET /api/reminders/pending` returned 401 after 12089 ms (before #1825).

On the macOS runner, Postgres (brew `postgresql@16`), the server, Metro and the iOS simulator all share one machine.

Also seen in that run, cause unknown: after the receipt flow's re-run passed its scan, the `onFlowComplete` relaunch (`e2e/helpers/launch-app.yaml`) found no known screen in 240 s (opened at 13:22:23, failed at 13:24:47). No screen dump exists from that moment.

## Acceptance Criteria

- [ ] Find out what saturates: CPU or IO contention from the simulator, pool exhaustion (`server/db.ts`, `connectionTimeoutMillis: 5_000`), or Postgres itself. Check runner load or pool wait counts during a run.
- [ ] Apply a fix chosen from that evidence, such as pool or timeout settings for the CI server only, or Postgres tuning in the workflow.
- [ ] Two dispatch runs show no server request slower than 5 s and no "connection timeout" in server.log.

## Implementation Notes

- Files likely in scope: `.github/workflows/e2e-regression.yml` (the Postgres setup around line 298) and `server/db.ts` (pool settings; change production values only with evidence).
- Measure before changing anything. A longer timeout without a cause only hides the problem.

## Updates

### 2026-11-10

- Initial creation (deferred finding from the #1825 investigation).
