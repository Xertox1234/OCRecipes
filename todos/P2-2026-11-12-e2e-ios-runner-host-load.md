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

Split out from `todos/archive/P2-2026-11-10-e2e-ios-ci-postgres-saturation.md` (owner call, 2026-11-12). #1845 fixed that todo's connection timeouts (0 in both acceptance runs). Its other criterion, "no server request slower than 5 s", cannot be met by connection changes: `SELECT 1` on an already-open connection took 4.3 s server-side in run 43104528885.

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

### 2026-11-12 (findings)

- **apsd is in a retry storm on CI, not locally.** The flows' Maestro `device-simulator.log` (run 43143893480, "Auth - Login flow") has 529k lines; 193k are apsd. It tries `sandbox.push.apple.com`, ends "Connected on 0 interfaces … consecutiveFailures 6", and retries with no backoff: ~920 attempts in one 3-minute flow. A fresh local simulator on the same runtime (iOS 26.5, 23F77) settled to ~1–2% total CPU within 8 minutes and apsd never appeared.
- **The idle simulator slows the build.** Build-window averages: nightly 43182452033 (timed out at 70 min) had clang 78% against sim diagnosticd + apsd + host diagnosticd ≈ 66%; acceptance run 43143893480 (45-min build) had clang 106% against ≈ 30%.
- **The `log stream --style syslog` is Maestro 2.9.0**, not Xcode or expo: `IOSDriver.startDeviceLogCapture` (maestro-client.jar) writes `logs/device-simulator.log` per flow, 793 MB in total for that run. A new process per flow (11 PIDs). Maestro 2.6.0 does not have it. No CLI option to turn it off was found (`captureFullArtifacts` in the suite path comes from `--analyze`; the single-flow path was not traced further).
- **Lowering simulator logging does not work:** `simctl spawn <udid> log config --mode level:off` returns "Simulator unable to set system mode".
- **apsd can be stopped:** `launchctl disable` + `bootout system/com.apple.apsd` inside a throwaway simulator removed it; it stayed gone after 65 s and an app launch; SpringBoard and `openurl` were fine. The app's `registerPushToken` never gets a token on CI anyway (apsd never connects), so the app sees no change.
- **Memory is tight too:** free pages stayed near 60 MB through the flows and swap-outs rose from 29k to 63k pages in the first 10 minutes of flows (run 43143893480).
- **Larger runner:** `macos-26-xlarge` is an M2 with 5 CPUs and 14 GB RAM (GitHub's larger-runners reference), $0.102/min (`macos_xl`, actions-runner-pricing). Larger runners are billed for public repositories too, need a card on file and a spending limit above $0. At ~100 min per iOS job, about $10 a run. The repo is user-owned; whether a personal account can use it was not confirmed. Owner decision.
- **Change made:** the Boot step stops apsd in the simulator; the sampler counts the simulator's apsd and adds the ten largest processes by RSS every 5 minutes. Overlaps `todos/P2-2026-11-12-e2e-ios-build-step-time-margin.md` (build CPU).

### 2026-11-12 (dispatch 1 with apsd stopped: run 43258730882 on 5d06e184e, iOS and Android green)

Against acceptance run 43143893480:

- Simulator apsd: absent in 135 of 135 samples.
- Build: 46.4 min (was 45.5); clang 111% of CPU (was 106%), no simulator process in the build-window top 10. Stopping apsd did not shorten this build, so the 70-minute nightly is not explained by apsd alone (see the build-time todo).
- Flows: simulator diagnosticd 24% → 11.6%, host diagnosticd 14% → 4.7%, Maestro's `log` 15% → 7.5%; device-simulator.log total 793 MB → 278 MB.
- Requests: p50 299 → 288 ms, p99 6.7 → 3.3 s, over 5 s: 3 → 1. The one left is the first `GET /api/carousel` (9.1 s; 8.3 s in the baseline), started right after the first login; later carousel calls took 0.2–1.5 s. It is one SQL query and Postgres logged no statement over 1 s; the home screen's other requests in the same burst took 60–200 ms, so the event loop was not blocked.
- Hypothesis for that first call: the server and the pool's backends (opened by the seed step) sit idle through the build, which swaps (474 MB used at 17:24), and the first requests page them back in. Added a "Warm the backend after the build" step that logs in and times two concurrent rounds of home-screen requests before the flows.
