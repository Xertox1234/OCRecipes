---
title: "iOS E2E: receipt photo resize takes 600 ms on one attempt and over 30 s on the next"
status: in-progress
priority: medium
created: 2026-11-12
updated: 2026-11-12
assignee:
labels: [deferred, e2e]
github_issue:
---

# iOS E2E: receipt photo resize takes 600 ms on one attempt and over 30 s on the next

## Summary

In iOS E2E run 43120554293 the receipt-upload flow's retry showed "Could not read the receipt". The cause was the on-device resize (`expo-image-manipulator` `manipulateAsync`), which hit `RESIZE_TIMEOUT_MS` (30 s) in `client/lib/image-compression.ts`. The first attempt, minutes earlier, compressed the same photo in 600 ms. This is the recurring receipt-flow flakiness.

## Background

Deferred from the CI Postgres saturation work (`todos/archive/P2-2026-11-10-e2e-ios-ci-postgres-saturation.md`, PR #1845). The stage logging from #1826 named the failing step (metro.log of run 43120554293):

- Attempt 1: `Receipt scan took compress 600 ms, upload 767 ms, response 29 ms`. The flow then failed on the relaunch: `simctl openurl` timed out (`NSPOSIXErrorDomain` code 60).
- Attempt 2: `Receipt scan failed at compress after 30056 ms [Error: Image resize timed out after 30000 ms]`. No request reached the server.

The runner is a 3-vCPU, 7 GB VM that is CPU-starved for the whole flow phase (host-sample.log). Even so, a 50× swing on the same photo looks more like a resize that never settles than a slow one. The code comment above `SIZE_READ_TIMEOUT_MS` already records one iOS hang ("either can fail to settle on iOS", nightly 2026-11-04).

## Acceptance Criteria

- [ ] Find out why the system photo picker stays on "Loading…" (run 43132429962, both attempts) and whether the flow can wait for it or seed the photo differently.
- [ ] Find out whether the second resize is slow or never settles. For example, log the late result's arrival time through `onLateResult` in `resizeWithin`, or compare against host-sample.log CPU at that moment.
- [ ] Choose a fix from that evidence: retry the resize once, change resize parameters, or (if it is pure starvation) accept it and document it. Do not just raise the timeout.
- [ ] The receipt-upload flow passes on its first attempt in two dispatch runs.

## Implementation Notes

- Files in scope: `client/lib/image-compression.ts` (`resizeWithin`, `RESIZE_TIMEOUT_MS`), `client/hooks/useReceiptScan.ts`, and `e2e/flows/plan/receipt-upload.yaml`.
- Evidence: the logs-ios artifact of run 43120554293 (metro.log, host-sample.log, `e2e/maestro-output/Plan - Receipt photo upload reaches the server-2/`).

## Updates

### 2026-11-12

- Initial creation (deferred finding from the #1845 acceptance run).

### 2026-11-12 (later)

Two more failures in the same flow, seen in the #1845 acceptance runs:

- **The system photo picker never loaded** (run 43132429962, both attempts). The flow's `extendedWaitUntil` for `Photo, \w+ \d{2}, …` failed after 15 s, with the picker still showing "Loading…" (step-072 screenshot in the logs-ios artifact). This is before any of our code runs: no `Receipt scan` line in metro.log.
- **The relaunch after a passing scan failed** (run 43120554293, attempt 1): `simctl openurl` timed out with `NSPOSIXErrorDomain` code 60, in `e2e/helpers/launch-app.yaml`.
- Run 43143893480 passed the receipt flow on its first attempt.

All three failures (slow resize, stuck picker, openurl timeout) happen in simulator or system code while the host is CPU-starved; see `todos/archive/P2-2026-11-12-e2e-ios-runner-host-load.md`. Fixing the host load may fix some of them, so check the order of work before starting.

### 2026-11-12 (investigation)

**The picker wait was always marginal.** Across the four runs with the receipt flow's debug output (43143893480, 43258730882, 43273131678, 43283689921), the label `Photo, <date>, <time>` took 10.0, 10.9, 12.9 and 14.7 s to appear after the "Pick from gallery" tap, against a 15 s `extendedWaitUntil`. In 43283689921 attempt 1 the wait failed at 15 s. The picker was already showing the grid (step-072 screenshot), the label `Photo, November 12, 6:48 PM` (which matches the regex) is in the hierarchy dumped about 22 s after the tap, and the driver re-read the hierarchy every 0.3 s. So the label arrived between 15 and 22 s; Maestro wasn't looking at the wrong thing. The "Loading…" failure in 43132429962 is the same delay seen earlier. Fix: the wait is now 60 s. `extendedWaitUntil` returns as soon as the label shows, so passing runs are no slower.

**The resize is unlikely to be merely slow on this photo.** `e2e/assets/receipt.jpg` is 480×480 and 85 KB, so `fitWithinActions` returns no resize and `compressImage` makes one JPEG pass. It took 243 ms to 2.7 s in the branch runs above. A 30 s miss on this input points to a native call that never settles, not to CPU starvation, but that is still unproven: `resizeWithin` now logs `Image resize settled N ms after it started` when a timed-out resize finally answers, so the next occurrence's metro.log will say which. Note that Maestro relaunches the app for the retry, so a missing line can also mean the app was killed before the late answer. The resize hasn't recurred since 43120554293, so no retry or parameter change yet.

**The openurl timeout** (`NSPOSIXErrorDomain` 60 in `launch-app.yaml`) follows the failure in 43283689921 as well. It belongs to the relaunch after any failed flow, not to this flow, and isn't addressed here.
