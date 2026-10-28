---
title: 'E2E iOS: launch-app sometimes ends on the dev launcher''s "Searching for development servers" home'
status: done
priority: low
created: 2026-10-28
updated: 2026-10-28
assignee:
labels: [deferred, testing]
github_issue:
---

# E2E iOS: launch-app sometimes ends on the dev launcher home

## Summary

Some iOS flows fail attempt 1 inside `e2e/helpers/launch-app.yaml` with the simulator on the expo-dev-launcher home screen ("DEVELOPMENT SERVERS", "Searching for development servers..."), not the app and not the "There was a problem loading the project" error screen. The per-flow retry passes, so the nightly stays green.

## Background

Seen after the keep-warm step (#1587) and the relaunch loop (#1586) were in place. The artifacts show two different failures, not one:

- **A. Manifest stall (run 40604313571, Scan Barcode + Scan Photo).** The final screen is the "There was a problem loading the project" error screen (step-023 screenshot). The launcher home is only underneath it in the tree. The relaunch loop did fire and ran out of its 3 tries: from 01:05:49 to 01:08:37, eight manifest loads in a row timed out. In the simulator log each request connects to localhost:8081 in about 7ms, is sent, and gets no answer within the dev launcher's 10s limit (NSURLError -1001).
- **B. openLink timeout (run 40614765446, View item detail).** The first `openLink` FAILED after 15.8s: "Simulator device failed to open exp+ocrecipes://... Operation timed out" (NSPOSIXErrorDomain 60). The link never reached the app, and the failed command ended the flow before any gate ran.

The original "the gate does not list the launcher home" reading was wrong: the launcher home is in the tree during every load, so matching it would cut normal loads short.

## Acceptance Criteria

- [x] The cause is identified from attempt-1 artifacts (`commands.json` timings, dumps, `xctest_runner_*.log`, Metro log around the `openLink`).
- [x] (B fixed; A left to the per-flow retry by owner ruling) launch-app recovers from the launcher home (for example, the gate accepts "Searching for development servers.\*" and the bounded relaunch loop covers it), or the cause is fixed directly.
- [x] (Waived by owner ruling 2026-10-28) Two consecutive `workflow_dispatch` runs show no iOS flow failing attempt 1 in launch-app, counted from `commands.json`.

## Implementation Notes

- `e2e/helpers/launch-app.yaml`: readiness gate, the `repeat ... while "There was a problem loading the project.*"` loop, and header note (5).
- Artifacts: `logs-ios` of runs 40604313571 and 40614765446.
- Keep `stopApp` iOS-gated (Android uses a different app ID; see header note (5)).

## Scope Contract

- In scope: `e2e/helpers/**`, `e2e/flows/**`.
- Out of scope: app code, `.github/workflows/**`.

## Updates

### 2026-10-28

- Filed from the tab-tap fix's validation runs 40604313571 and 40614765446.

### 2026-10-28 (worked)

- **B fixed** (`fix/e2e-launch-openlink-retry`): each stopApp + openLink in launch-app.yaml is wrapped in `retry` (at most 2 retries), header note (6). The retry did not fire in runs 40679705881 or 40686366318 (no openLink failed), so it is unexercised so far.
- **A, cause measured.** The keep-warm loop now logs manifest and `/status` timings plus the load average to `metro-probe.log` (logs-ios), which reaches into `.github/workflows/**` beyond this todo's original scope. Run 40679705881: manifest p90 7.6s, 9 of 131 over 10s (max 33s at load 314); `/status` never over 0.38s. Metro answers promptly. What waits is the work per manifest request: `@expo/cli`'s ExpoGoManifestHandlerMiddleware runs `expo-updates runtimeversion:resolve` in a new Node process every time (0.3s CPU locally), and on the 3-CPU runner it queues behind the simulator.
- **A, renice tried and dropped.** Run 40686366318 reniced Metro to -10. It was slower at the same load (load 150-250: p90 12.8s vs 5.0s), and the load median doubled (281 vs 142). Its two stopApp failures were "Device became unreachable while processing deviceInfo" (the simulator driver dropping out), which also hit 8 flows at once in run 40690138910 without any renice, so they are not evidence against the renice.
- **A, still open (owner decision).** Removing the per-request spawn means patching the nested `@expo/cli` (patch-package or a CI-only edit) during the SDK 58 upgrade, for a flake the per-flow retry already absorbs. Without it, AC 3 cannot be met.

### 2026-10-28 (closed by owner ruling)

- #1597 merged (ce40706): openLink `retry` (B) and the `metro-probe.log` instrumentation (A).
- Owner ruling: leave A alone. Do not patch `@expo/cli` to stop the per-request `runtimeversion:resolve` spawn; the per-flow retry absorbs the remaining iOS attempt-1 manifest timeouts. AC 3 is waived on that ruling, not met. If attempt-1 launch failures grow beyond what the retry absorbs, raise the patch again with fresh `metro-probe.log` numbers.
