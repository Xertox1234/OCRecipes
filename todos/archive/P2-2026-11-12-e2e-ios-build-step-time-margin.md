---
title: "iOS E2E: the app build takes 31–70 min, so the 70-min step limit fails some runs"
status: done
priority: medium
created: 2026-11-12
updated: 2026-11-12
assignee:
labels: [deferred, e2e]
github_issue:
---

# iOS E2E: the app build takes 31–70 min, so the 70-min step limit fails some runs

## Summary

The nightly iOS E2E run on 2026-11-11 (42986537073) failed before any flow ran: the "Build and install iOS app" step hit its 70-minute `timeout-minutes`. Across the 13 runs checked during the saturation work, that step took between 31 and 70 minutes, with the same CocoaPods cache step each time. While builds come that close to the limit, some nightlies will keep failing for a reason unrelated to the app.

## Background

Found during the CI Postgres saturation work (`todos/archive/P2-2026-11-10-e2e-ios-ci-postgres-saturation.md`); the owner asked for it to be tracked on its own (2026-11-12).

The step's bound is tied to the job's: the comment above `Build and install iOS app` in `.github/workflows/e2e-regression.yml` derives `timeout-minutes: 160` for the job from setup about 6 min, build, pre-warm about 10 min, and flows about 64 min. Raising the build limit without re-deriving the job limit uses up the job's margin. That comment also says to re-measure the build time and revisit the bound.

The runner is a CPU-starved 3-vCPU VM (see `todos/archive/P2-2026-11-12-e2e-ios-runner-host-load.md`), which may explain part of the spread.

## Acceptance Criteria

- [x] Measure the build step's duration over recent iOS runs (the Checks API gives per-step start and end times), and split it into time spent in CocoaPods, Xcode compile and install where the logs allow.
- [x] Find out why it varies by more than 2×: a cache miss (Pods, DerivedData or ccache), the runner, or compile work. Check whether Xcode DerivedData or a compiler cache could be kept between runs.
- [x] Apply a fix chosen from that evidence: cut the build time, or re-derive both the step and job limits together in the same change, as the workflow comment requires.
- [ ] The next 5 nightly or dispatch runs finish the build step within its limit.

## Implementation Notes

- Files in scope: `.github/workflows/e2e-regression.yml` (the iOS job: cache steps, the `build-ios` step and its comment, the job's `timeout-minutes`).
- Evidence: nightly run 42986537073 (the build step timed out). Durations for the comparison come from `gh api repos/{owner}/{repo}/actions/runs/<id>/jobs`.
- Native folders are generated (Expo CNG): never edit `ios/`.

## Risks

- A new cache that restores a stale build could hide a native change. Key it on the inputs that change the native build (lockfile, app config, patches).

## Updates

### 2026-11-12

- Initial creation.

### 2026-11-12 (from the host-load todo)

- The booted, idle simulator competes with the compile: clang got 78% CPU in the timed-out nightly 43182452033 against 106% in the 45-minute build of 43143893480, while simulator apsd/diagnosticd used ≈ 66% and ≈ 30%. `todos/archive/P2-2026-11-12-e2e-ios-runner-host-load.md` stops apsd (its retry storm) at boot. Measure build times after that lands before choosing a build-time fix. `expo run:ios` boots its device before compiling (resolveDevice → ensureBootedAsync), so a later boot needs a separate xcodebuild + `expo run:ios --binary`.

### 2026-11-12 (executed)

- Measured 38 iOS builds (last 40 runs; Checks API step times plus job logs). Build step: median 44.7m, mean 46.5m, 24.8-70.2m. Nightly (schedule) n=11 median 52.5m; dispatch n=27 median 43.5m. Three builds hit the 70m bound: nightlies 42986537073 and 43182452033, dispatch 43299922691 (8%).
- Split: pod install 1-6m; xcodebuild compile 23-66m over the same ~2031 compile units; install under 1m. Pods cache hit on 6 of the 40 runs and the restore step is ~0.1m, so Pods caching does not drive the spread. No compiler cache in play (`[Ccache]: Removing Ccache` in all 38 build logs).
- Cause of the spread: the same workload runs 1.7x-2.7x slower on a slow runner. Runs 43317178019 and 43329068850 built the same sha (08f57e7f7) in 42.2m and 24.8m. The two timed-out nightlies were close to finishing (43299922691 was linking the app target), so their true durations are above 70m.
- Fix: build step 70 -> 90m and job 160 -> 180m together (6 + 90 + 10 + 64 + 10 margin). 90m is about 2x the dispatch median.
- Not done: ccache or DerivedData (needs runner measurements that cannot be made without dispatching runs). The last criterion (next 5 runs finish the build within its limit) cannot be checked in this run; check it after the next 5 nightly or dispatch runs. The host-load fix (#1852) has only 5 runs since it landed (24.8-46.4m, none a nightly), too few to judge; tighten the bound if later runs show it helped.
