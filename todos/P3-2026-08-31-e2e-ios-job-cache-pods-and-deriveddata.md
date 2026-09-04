---
title: "E2E iOS job: cache Pods + DerivedData so the ~34-minute cold build stops dominating the nightly"
status: backlog
priority: medium
created: 2026-08-31
updated: 2026-09-03
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

- [x] `ios/Pods` restored from `actions/cache` keyed on `ios/Podfile.lock` + `package-lock.json` + the selected Xcode version; a lockfile change misses cleanly.
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

### 2026-09-02

- Implemented the first two acceptance criteria: `ios/Pods` and Xcode
  DerivedData (redirected via `defaults write com.apple.dt.Xcode
IDECustomDerivedDataLocation "DerivedData"`, since `expo run:ios` exposes
  no `-derivedDataPath` flag) are now cached via `actions/cache/restore` +
  `actions/cache/save` in `.github/workflows/e2e-regression.yml`, gated so a
  failed/cancelled build never persists a locked/partial sandbox, and gated
  again on `cache-hit` so an already-warm run doesn't re-tar and re-upload
  either cache on every green run.
- The last two acceptance criteria — a measured cache-hit build time with
  the timeouts re-derived from it, and one green `workflow_dispatch` on
  `main` with the cache warm — are **not yet done** and cannot be closed by
  an autonomous agent: they require an actual human-triggered
  `workflow_dispatch` (ideally two: one to populate the cache, one to
  observe a real warm-cache build). The 70m step / 160m job timeouts are
  deliberately left at their proven cold-build values rather than shrunk on
  an unmeasured guess — see the comment above `timeout-minutes: 160` in the
  workflow file for the arithmetic this needs once a real number exists.
  Also unmeasured: DerivedData's on-disk size against GitHub's 10 GB
  per-repo cache budget (shared with `ci.yml`'s own npm caches) — check
  `gh cache list --limit 50` after the first dispatch; the workflow comment
  above the cache-key step names the fallback (drop DerivedData, keep Pods)
  if it's crowding the budget.

### 2026-09-03 — REOPENED: the measurement arrived and it contradicts the premise

This todo was archived `done` before its two measurement criteria could be satisfied — the
code half looked finished, and the numbers only exist after a `workflow_dispatch`. They now
exist, and DerivedData caching appears to be a **net loss**.

Three `workflow_dispatch` runs, iOS `Build and install iOS app` step, same runner pool:

| Run         | Cache state at build                                 | Build time  |
| ----------- | ---------------------------------------------------- | ----------- |
| 33790849004 | cold — nothing stored                                | **39m 03s** |
| 33796820565 | DerivedData `restore-keys` PREFIX hit, Pods MISS     | **36m 48s** |
| 33802822765 | exact hit on BOTH (save steps `skipped`, proving it) | **51m 01s** |
| 33826146222 | exact hit on BOTH (save steps `skipped`, proving it) | **47m 17s** |

The genuinely warm run was **~12 minutes SLOWER than cold**. Restoring 1.6 GiB of
DerivedData, plus whatever Xcode spends validating and then discarding most of it, costs
more than it saves.

Why run 2 was not warm despite following run 1: `package-lock.json` was bumped by a
Dependabot merge between the two dispatches, and **both** key formulas hash it
(`PODS_CACHE_KEY` and `DD_CACHE_KEY`). A `restore-keys` prefix match does not set
`cache-hit: 'true'` — only an exact primary-key match does — so run 2 restored a stale
DerivedData tree and rebuilt Pods from scratch. Run 3 was the FIRST true warm
measurement; run 4 is the second, and it agrees — 47m 17s, also well above cold.

**Pods, separately, looks clearly worth keeping**: 132 MiB, restores in 4 seconds, exact-match
only. It is DerivedData (1.63 GiB, ~40s restore, ~2m30s save) that does not pay for itself.

### What reopening this asks for

The `DerivedData cached` criterion is un-ticked, because its own wording offers two ways to
satisfy it — cache it, **or** document it as not worth it after measurement — and the
measurement now points at the second. Deciding between them is the remaining work:

- **Drop DerivedData caching, keep Pods.** Removes ~40s restore + ~2m30s save per run and,
  on this evidence, a large build-time penalty. Also removes a 1.6 GiB artifact from the
  cache quota, which this todo's own Risks section flagged as a trigger to reconsider.
- **Keep it and investigate why it misses.** A restored DerivedData tree that Xcode largely
  invalidates is the usual cause; `-derivedDataPath` pinning interacts with absolute paths
  baked into module maps and `.pcm` files. Worth a look only if someone wants to make it work
  rather than take the simpler win.

Either way the workflow comment's timeout arithmetic must be re-derived from real numbers —
that criterion was never met and the comment still cites the pre-cache estimate.

### Caveat on the evidence, stated plainly

Shared GitHub-hosted macOS runners vary, so runner noise is a real confound. But the warm
condition now has TWO independent measurements — 51m 01s and 47m 17s — and both sit well
above the 39m 03s cold run. A single warm outlier could have been noise; two agreeing ones
landing 8–12 minutes on the wrong side of cold is a signal.

Cold and prefix-hit still have one measurement each. That asymmetry does not matter for the
DROP decision, which only needs the cache to be not clearly winning — already shown twice.
It would matter for a KEEP decision, so re-measure cold before choosing that branch.

### Related

- The `One green workflow_dispatch on main with the cache warm` criterion is also still
  unmet. It needs the iOS suite green on attempt 1, which is blocked by a **pre-existing**
  10 s timeout in `e2e/helpers/ensure-logged-out.yaml` (issue #908; candidate fix in PR
  #919) — nothing in this todo's scope. Sequence the green-run criterion after that
  resolves, and do not read a red run before then as evidence about caching.

  An earlier draft of this section blamed PR #903 for breaking the suite ("3/3 green
  before, 2/2 red after"). **That was wrong and is retracted.** Those counts were
  job-level verdicts, and this workflow re-runs failed flows — so a green job can hide an
  attempt-1 failure. Compared at the flow level, the pre-#903 control run also failed
  `2/9` on attempt 1, with the same two flows and the same assertion text. There was no
  regression at that boundary. Any future claim here about a run's outcome should cite
  per-flow attempt-1 results, never `conclusion`.
