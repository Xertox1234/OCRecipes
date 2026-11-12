---
title: "iOS E2E: the app build takes 31–70 min, so the 70-min step limit fails some runs"
status: backlog
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

- [ ] Measure the build step's duration over recent iOS runs (the Checks API gives per-step start and end times), and split it into time spent in CocoaPods, Xcode compile and install where the logs allow.
- [ ] Find out why it varies by more than 2×: a cache miss (Pods, DerivedData or ccache), the runner, or compile work. Check whether Xcode DerivedData or a compiler cache could be kept between runs.
- [ ] Apply a fix chosen from that evidence: cut the build time, or re-derive both the step and job limits together in the same change, as the workflow comment requires.
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
