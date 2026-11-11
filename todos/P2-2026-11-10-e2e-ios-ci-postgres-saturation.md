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
- **Connection churn turns the slowness into 500s.** `server/db.ts` sets neither `idleTimeoutMillis` nor `min`, so pg-pool closes any connection idle for 10 s (default) down to 0. The timeouts cluster in the 5–7 parallel reads after a login or relaunch that follows an idle gap: each needs a fresh backend process. (The run below showed Postgres uses `trust` auth, so there is no SCRAM step.)
- **The whole host is slow, all the time.** Request p50 is 614 ms (green) and 1147 ms (red); p90 is 3.1 s and 8.0 s; logins take 10–24 s. metro-probe.log puts load1 at a median of about 250–290 for the whole flow phase, and fast requests ran at the same load as slow ones. macOS load average is inflated, though: an idle 10-core laptop showed 115, so it does not say what is runnable.
- **iOS build time varies 31–70 min** across the last 13 runs, all with the same CocoaPods cache step. The 2026-11-11 nightly (42986537073) hit the 70-min build-step timeout before any flow ran. That is a separate failure, possibly the same slow-host cause.
- **No Android control yet**: the Android job ran with `LOG_LEVEL: silent`.

Next: a workflow-only measurement PR (per-process host sampler, Postgres connection and slow-statement logging, Android `LOG_LEVEL: info`) and one dispatch run. Then choose between keeping CI connections warm (pool `min`/`idleTimeoutMillis` behind an env var the workflow sets), Postgres durability settings for the throwaway database, or trimming what runs on the host. Note that "no request slower than 5 s" may not be reachable by pool settings alone, since logins already take 10–24 s at this load.

#### Measurement run 43104528885 (#1844 merged; both jobs green)

- **Android control:** 256 requests, p50 9 ms, p90 49 ms, max 471 ms, 0 DB timeouts. iOS in the same run: p50 684 ms, p90 3.3 s, 2 connection timeouts. Same server, same pool, same flows, so the cause is the macOS host, not `server/db.ts`.
- **The host is a 3-vCPU, 7 GB VM** (`VirtualMac2,1`). During flows the busiest processes were the simulator's and the host's `diagnosticd` (~42% combined average), the iOS app, SpringBoard, a `log` process (~14%, present 22:36:59–23:13:23, the flow phase only) and apsd. The server `node` process averaged 1.8% and Postgres did not reach the top 10, so they are not short of work; they wait for a CPU.
- **Postgres itself was not slow; it was not scheduled.** `SELECT 1` took up to 4.3 s server-side. There were no `connection authenticated` lines, so auth is `trust` with no SCRAM. Received→authorized gap: p50 59 ms, max 1.8 s.
- **`localhost` costs a retry under load.** `DATABASE_URL` uses `localhost`, which macOS resolves to `::1` first. Node 24 Happy Eyeballs (`autoSelectFamily` true, 250 ms per address, measured on v24.20.0) dropped the `::1` attempt whenever it could not finish in 250 ms, then retried over IPv4. 30 of 210 connections were dropped `::1` attempts, each paired with a `127.0.0.1` retry (30 of 30). The retry lag was p50 584 ms and max 3.2 s, taken out of the 5 s connect budget. Both connection timeouts (23:03:41, 23:03:42) began with a dropped `::1` attempt at 23:03:36.
- **Fix in this PR:** the iOS job's `DATABASE_URL` uses `127.0.0.1`. Android keeps `localhost` and stays the control; it had no connection timeouts in the measured run (its address resolution order was not measured). The sampler now also logs the args and parent of any `log` process. On a laptop, a sim-internal `log stream` watching backboardd orientation messages (parent `launchd_sim`) was found, which may be the same process.
- **Acceptance criteria:** this fix targets "no connection timeout in server.log". "No server request slower than 5 s" is not reachable by connection changes: `SELECT 1` on an open connection took 4.3 s and logins take 10–24 s on this 3-vCPU host. That half is host load and needs an owner call: accept it, or open a follow-up on trimming what runs on the runner.
- **Fallback, if an acceptance run still shows a connection timeout:** keep CI connections warm (pool `min` and `idleTimeoutMillis` set from env vars that only the iOS job sets, TDD in `server/db.ts`). `connectionTimeoutMillis` stays at 5 s.
