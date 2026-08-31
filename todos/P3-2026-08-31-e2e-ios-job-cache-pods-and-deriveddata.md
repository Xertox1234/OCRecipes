---
title: "E2E iOS job: cache Pods + DerivedData so the ~34-minute cold build stops dominating the nightly"
status: backlog
priority: low
created: 2026-08-31
updated: 2026-08-31
assignee:
labels: [deferred, testing]
github_issue:
---

# E2E iOS job: cache Pods + DerivedData so the ~34-minute cold build stops dominating the nightly

## Summary

Every E2E iOS run rebuilds the native app from scratch on a shared macOS runner: `pod install`
(~3m) plus a full Xcode 26.3 compile of RN 0.81 + VisionCamera + Nitro (~30m) — measured at
33m33s (run 33352527232) and 34m16s (run 33348888795). That single step is the majority of the
job's wall clock, its largest cost, and the biggest exposure window for runner contention (the
first re-enabled nightly, run 33373712907, was killed by a step bound sized one minute past a
normal build). Caching `ios/Pods` and Xcode DerivedData would cut it to minutes.

## Background

Deferred from the 2026-08-31 fix that re-sized the build-step bound to measured reality
(70m). Sizing budgets to a 34-minute build is the honest short-term fix; making the build not
cost 34 minutes is the real one. Not done in that PR because cache keying/invalidation is its
own design (Podfile.lock + package-lock.json + Xcode version for Pods; DerivedData is less
deterministic and may need `-derivedDataPath` pinning to be cacheable at all).

## Acceptance Criteria

- [ ] `ios/Pods` restored from `actions/cache` keyed on `ios/Podfile.lock` + `package-lock.json` + the selected Xcode version; a lockfile change misses cleanly.
- [ ] DerivedData cached (pinned `-derivedDataPath`, or documented as not worth it after
      measurement) with a key that includes the Xcode version and a source hash coarse enough to
      hit across docs-only changes.
- [ ] Measured: cache-hit build step time recorded in the workflow comment, and the step/job
      timeouts re-derived from the new numbers (the arithmetic lives in the workflow comments).
- [ ] One green `workflow_dispatch` on `main` with the cache warm.

## Implementation Notes

- Files in scope: `.github/workflows/e2e-regression.yml` (iOS job only; Android is 8/8 green
  and ~30m total — leave it).
- `expo run:ios` runs `pod install` itself; a Pods cache hit makes that a no-op. Check whether
  the `Podfile.lock` is committed and stable (it is regenerated on deployment-target changes).
- Watch for the "database is locked" failure mode if a cached DerivedData is restored while a
  stale lock file is inside it — exclude `Build/Intermediates.noindex/XCBuildData/*.db*` or
  clear locks on restore.

## Scope Contract

- **Mechanisms to use:** `actions/cache` only — no self-hosted runner, no third-party build
  service.
- **Files in scope:** `.github/workflows/e2e-regression.yml`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. Independent of `todos/P3-2026-08-30-e2e-suite-dedup-and-maintainability-followups.md`
  (touches different parts of the same file — coordinate merge order, not content).

## Risks

- A stale-but-key-matching DerivedData can produce confusing incremental-build failures;
  prefer a conservative key and measure before trusting.
- Cache size limits (10 GB repo-wide) — DerivedData for this app may be several GB; Pods alone
  may be the pragmatic win.

## Updates

### 2026-08-31

- Initial creation, deferred from the build-step-budget fix after nightly run 33373712907.
