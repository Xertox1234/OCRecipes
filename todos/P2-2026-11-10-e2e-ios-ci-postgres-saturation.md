---
title: "iOS E2E: CI Postgres saturates, requests take 10-16 s and time out"
status: backlog
priority: medium
created: 2026-11-10
updated: 2026-11-11
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

### 2026-11-11

Measured from the logs-ios artifacts of runs 42810549290 (red) and 43064552610 (green):

- **Not pool exhaustion.** Every "Connection terminated due to connection timeout" comes from pg-pool's `newClient` path (`node_modules/pg-pool/index.js:276`): a NEW connection took over 5 s to open. The pool-full error ("timeout exceeded when trying to connect", line 224) appears 2 times in the red run and 0 in the green, against 14 and 4 connection timeouts. The green run had them too; no flow happened to land on one.
- **Connection churn turns the slowness into 500s.** `server/db.ts` sets neither `idleTimeoutMillis` nor `min`, so pg-pool closes any connection idle for 10 s (default) down to 0. The timeouts cluster in the 5–7 parallel reads after a login or relaunch that follows an idle gap: each needs a fresh backend (fork + SCRAM auth).
- **The whole host is slow, all the time.** Request p50 is 614 ms (green) and 1147 ms (red); p90 is 3.1 s and 8.0 s; logins take 10–24 s. metro-probe.log puts load1 at a median of about 250–290 for the whole flow phase, and fast requests ran at the same load as slow ones. macOS load average is inflated, though: an idle 10-core laptop showed 115, so it does not say what is runnable.
- **iOS build time varies 31–70 min** across the last 13 runs, all with the same CocoaPods cache step. The 2026-11-11 nightly (42986537073) hit the 70-min build-step timeout before any flow ran. That is a separate failure, possibly the same slow-host cause.
- **No Android control yet**: the Android job ran with `LOG_LEVEL: silent`.

Next: a workflow-only measurement PR (per-process host sampler, Postgres connection and slow-statement logging, Android `LOG_LEVEL: info`) and one dispatch run. Then choose between keeping CI connections warm (pool `min`/`idleTimeoutMillis` behind an env var the workflow sets), Postgres durability settings for the throwaway database, or trimming what runs on the host. Note that "no request slower than 5 s" may not be reachable by pool settings alone, since logins already take 10–24 s at this load.
