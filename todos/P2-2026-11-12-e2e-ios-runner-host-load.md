---
title: "iOS E2E: the 3-vCPU macOS runner is CPU-starved, so requests take seconds"
status: backlog
priority: medium
created: 2026-11-12
updated: 2026-11-12
assignee:
labels: [deferred, e2e]
github_issue:
---

# iOS E2E: the 3-vCPU macOS runner is CPU-starved, so requests take seconds

## Summary

During iOS E2E flows the runner has too little CPU for the simulator, the app, Metro, the server and Postgres together. Server requests run at p50 300–700 ms with logins at 10–24 s; on Android with the same server and flows, p50 is 9 ms. This item finds out whether any of that load can be removed or moved, so that no server request takes more than 5 s.

## Background

Split out from `todos/P2-2026-11-10-e2e-ios-ci-postgres-saturation.md` (owner call, 2026-11-12). #1845 fixed that todo's connection timeouts (0 in both acceptance runs). Its other criterion, "no server request slower than 5 s", cannot be met by connection changes: `SELECT 1` on an already-open connection took 4.3 s server-side in run 43104528885.

What was measured (host-sample.log in the logs-ios artifacts of runs 43104528885, 43132429962 and 43143893480):

- The runner is a `VirtualMac2,1` VM with 3 vCPUs and 7 GB RAM.
- Busiest during flows: the simulator's and the host's `diagnosticd` (about 42% combined on average), the iOS app, SpringBoard, apsd, and a `log stream --style syslog` process (about 14%) whose parent is the simulator's `launchd_sim`. That `log stream` runs inside the simulator; the workflow does not start it.
- The server `node` process averaged 1.8% CPU and Postgres never reached the top 10. They are not busy; they wait to be scheduled.
- macOS load average is not a useful gauge here: an idle 10-core laptop showed 115.

## Acceptance Criteria

- [ ] Find which simulator or host processes can be reduced or turned off in CI, and how. Candidates to check: why `diagnosticd` is busy and whether simulator logging can be lowered (`xcrun simctl spawn <udid> log config`), what starts the sim-internal `log stream`, and whether apsd or other simulator services can be quieted.
- [ ] Find out whether a larger macOS runner is available to this repo, and at what cost. Changing it is an owner decision.
- [ ] Apply what the evidence supports, then in two dispatch runs: no server request slower than 5 s in server.log, or a written finding that it is not reachable on this runner. Either result closes this item.

## Implementation Notes

- Files in scope: `.github/workflows/e2e-regression.yml` (the iOS job: simulator boot, the host load sampler step, runner label).
- The host load sampler from #1844 already logs the top processes every 30 s, so a before-and-after comparison needs no new tooling.
- Do not touch `server/db.ts`: the Android control shows the server and pool are fine.
- Analysis scripts used for the saturation work (request percentiles, Postgres connection timing) were scratch files, not in the repo. `parse.mjs` reads pino `server.log` and prints request p50/p90/max; re-create it if needed.

## Risks

- Lowering simulator logging could hide information that later E2E debugging needs. Keep metro.log and server.log as they are.
- A larger runner may cost more per minute. Check before switching.

## Updates

### 2026-11-12

- Initial creation (follow-up the owner asked for when closing the saturation todo).
