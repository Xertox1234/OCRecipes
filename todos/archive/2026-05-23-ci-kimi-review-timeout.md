---
title: "Bump CI kimi-review timeout — 180s flakes on a cold cache"
status: done
priority: low
created: 2026-05-23
updated: 2026-05-23
assignee:
labels: [deferred, ci]
github_issue:
---

# Bump CI kimi-review timeout (180s flakes on cold cache)

## Summary

The CI "Kimi Review" job times out and fails non-deterministically on a cold
prompt cache. Raise its timeout (and/or warm the cache) so a slow-but-valid
review run doesn't show up as a red check.

## Background

On PR #246 the Kimi Review job failed with `kimi-review timed out after 180s`.
Re-running the same job — with no code change — passed in **40s** because the
prompt cache was warm the second time. So the 180s budget is large enough for a
warm run but too tight for the first (cold-cache) run, producing false-red
checks that require a manual re-run. The substantive gates (tests, coverage,
lint/types) were green throughout, so this is pure CI ergonomics.

## Acceptance Criteria

- [ ] CI `kimi-review` no longer fails on a cold-cache run for a normal-sized PR diff
- [ ] Timeout value is set with headroom over observed cold-cache latency (≥ ~300s, or justified)
- [ ] Local pre-commit budget (`timeout 120` in `.husky/pre-commit`) reviewed for the same risk and left consistent or intentionally diverged
- [ ] No change to review strictness (same tiers/patterns; CRITICAL still blocks)

## Implementation Notes

- CI timeout lives in `scripts/ci-kimi-review.sh` (the `##[error]kimi-review timed out after 180s` path). Bump the per-call timeout there.
- The local gate uses a separate `timeout 120` / `gtimeout 120` wrapper in `.husky/pre-commit` — decide whether to keep them divergent (local should stay snappy) or align.
- Alternative/companion fix: pre-warm the prompt cache in CI (a cheap warm-up call) so the real review hits a warm cache. Lower priority than just raising the ceiling.
- Keep it simple: a timeout bump is likely the whole fix. Don't restructure the review pipeline.

## Dependencies

- None.

## Risks

- Too-high a timeout slows the visible failure path when kimi-review is genuinely hung (vs. slow). Pick a bound that covers cold-cache latency with margin but still fails reasonably fast on a true hang.

## Updates

### 2026-05-23

- Created after PR #246's Kimi Review flaked at 180s then passed in 40s on re-run.
