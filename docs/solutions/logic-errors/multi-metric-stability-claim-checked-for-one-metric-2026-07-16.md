---
title: A "metrics are stable" justification that was verified for only one of the cited metrics
track: bug
category: logic-errors
tags: [harness, telemetry, docs, decision-records]
module: shared
applies_to: ["todos/**/*.md", "docs/superpowers/specs/**/*.md", "docs/research/**/*.md"]
symptoms: ["A decision record asserts multiple metrics are stable across two measurements while showing the before/after comparison for only one", "Re-deriving each named metric from raw counts shows one moved materially (e.g. 12.7% → 9.4%) between the same two reads", "The flat metric and the drifted metric are coupled shares of the same total, so the drift was silently absorbed by a third share"]
created: 2026-07-16
severity: low
---

# A "metrics are stable" justification that was verified for only one of the cited metrics

## Problem

A close-out record justified ending a data-collection window early with "the two load-bearing numbers (deferral share, injected share) are both stable across two measurements." Only the deferral share had actually been checked (2.6% → 2.6%, flat). The injected share — cited as stable in the same sentence — had drifted 74/583 = 12.7% → 232/2476 = 9.4% between the same two snapshots, a ~26% relative move absorbed into the pointer share. The aggregate stability claim was false for half the metrics it named, and that record is inherited verbatim by any future revival of the decision.

## Symptoms

- A plural stability claim ("the numbers", "both metrics", "the shares") backed by an explicit before/after comparison for only one member of the set.
- Action-mix or share-of-total metrics asserted stable individually when they are coupled (shares sum to 100% — one flat share says nothing about how the rest redistributed).
- The decision text survives review only because the *conclusion* is independently supported; the *stated evidence* is still wrong.

## Root Cause

The writer verified the metric tied to the decision threshold (deferral share, which had a numeric >10% re-trigger) and then generalized the "stable" adjective to every metric mentioned nearby without re-deriving each one from the raw counts. Composite share metrics make this trap easy: the eye-catching number (the one with a threshold) can be flat while its siblings shift against each other.

## Solution

Scope stability claims per metric, and only to metrics actually re-derived from both measurements. In the fixed record: the deferral share keeps its "identical across 4× more data" claim (it is flat and is the metric tied to the numeric re-trigger); the injected share's drift is stated explicitly (12.7% → 9.4%) together with why it is not a decision input (session dedup makes injection a first-touch-per-session event, so its share is workload-shape-dependent by construction).

## Prevention

- Before writing "X and Y are stable," compute X_then/X_now and Y_then/Y_now separately from raw counts. Any metric not recomputed does not appear in the stability claim.
- For share-of-total metrics, treat the set as coupled: check where a flat share's siblings moved before asserting anything about the mix.
- Tie each stability claim to its decision role — a metric with no numeric threshold attached does not belong in the "load-bearing" list at all.

## Related Files

- `todos/archive/P3-2026-07-05-pg-injection-ranking-layer.md` — the corrected close-out record (2026-07-16 entry)
- `docs/superpowers/specs/2026-07-16-pg-injection-ranking-layer-design.md` — the corrected telemetry-snapshot section (local-only)

## See Also

- [trust-flag-conflated-with-secondary-source-agreement](trust-flag-conflated-with-secondary-source-agreement-2026-07-16.md) — same failure family: a stated signal not backed by the evidence it claims to represent
