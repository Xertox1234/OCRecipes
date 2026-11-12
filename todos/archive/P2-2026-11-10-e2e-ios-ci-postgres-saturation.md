---
title: "iOS E2E: CI Postgres saturates, requests take 10-16 s and time out"
status: done
priority: medium
created: 2026-11-10
updated: 2026-11-12
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

- [x] Find out what saturates: CPU or IO contention from the simulator, pool exhaustion (`server/db.ts`, `connectionTimeoutMillis: 5_000`), or Postgres itself. Check runner load or pool wait counts during a run.
- [x] Apply a fix chosen from that evidence, such as pool or timeout settings for the CI server only, or Postgres tuning in the workflow.
- [x] Two dispatch runs show no "connection timeout" in server.log.
- [ ] ~~No server request slower than 5 s~~ — moved to `todos/P2-2026-11-12-e2e-ios-runner-host-load.md` (owner, 2026-11-12).

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

#### Acceptance run 1: 43120554293 (head 508e34e19, iOS red)

- **The IPv4 change worked:** all 175 connections came in on `127.0.0.1`, and none were dropped.
- **2 connection timeouts remained,** both in health checks (00:31:05, 00:43:57). In each, Postgres itself took 6.2 s and 7.6 s from "connection received" to "authorized", which is backend start on the starved host. The fallback was therefore applied in this PR: `server/db.ts` reads `DB_POOL_IDLE_TIMEOUT_MS` (digits only; unset leaves pg's 10 s default), and the iOS job sets it to `0`. pg-pool then never closes an idle connection (`node_modules/pg-pool/index.js:409` only arms the idle timer when the value is truthy), so connections opened once are reused instead of reopened after every idle gap.
- **The red flow was the receipt upload, and not because of the database.** Attempt 1's scan succeeded (compress 600 ms, upload 767 ms, response 29 ms), but the relaunch afterwards failed: `simctl openurl` timed out (`NSPOSIXErrorDomain` code 60). Attempt 2 showed "Could not read the receipt" and logged `Receipt scan failed at compress after 30056 ms [Error: Image resize timed out after 30000 ms]` (metro.log; the stage logging added in #1826). So the receipt flakiness is the on-device image resize, 600 ms on one attempt and over 30 s on the next. That belongs to its own item.

#### Closed 2026-11-12 (#1845 merged 4dc4d9e38)

- Acceptance runs 43132429962 and 43143893480, both on head 4594bb773: **0 "connection timeout" lines** in server.log. Postgres received 11 and 12 connections over the whole run, against 175–210 before. Request p50 was 419 ms and 299 ms.
- 43143893480 passed on iOS and Android. 43132429962 was red only in the receipt flow (the system photo picker stayed on "Loading…"), which is tracked in `todos/P2-2026-11-12-e2e-ios-receipt-image-resize-timeout.md`.
- The `log` process is `log stream --style syslog` inside the simulator (parent `launchd_sim`); the workflow does not start it.
- Owner calls: "no request slower than 5 s" is host load, moved to `todos/P2-2026-11-12-e2e-ios-runner-host-load.md`. The 31–70 min build time is tracked in `todos/P2-2026-11-12-e2e-ios-build-step-time-margin.md`.
