---
title: "MiniSearch — Correctness & Perf Followups"
status: backlog
priority: medium
created: 2026-04-17
updated: 2026-04-17
assignee:
labels: [search, performance, audit-followup]
---

# MiniSearch Correctness & Perf Followups

## Summary

The MiniSearch cluster (H3–H6, H10) landed in audit 2026-04-17, but two
follow-ups remain: the `mealType` filter effectively bypasses community
recipes, and the post-search filter chain allocates 9 intermediate arrays
per search.

## Background

Audit 2026-04-17 M9 (mealType filter bypass) and M22 (filter chain
allocations). These were deferred because they're correctness/perf nits
that don't block users today — community recipes are displayed regardless
of meal-type, and filter chains handle current traffic fine — but worth
cleaning up together with the loader work.

## Acceptance Criteria

- [ ] **M9** Choose one of two resolutions: 1. **Classify community recipes:** run `inferMealTypes(title, ingredients)`
      at community-recipe insert time and persist to the `mealTypes` column,
      so the filter works symmetrically. 2. **Explicit opt-in:** change filter semantics so "breakfast" excludes
      community recipes by default, with a separate `?includeUnclassified=true`
      query param.

      Option 1 is preferred — it fixes the root cause and gives better search
      quality for all meal-type filters.

- [ ] **M22** Consolidate the 9 sequential `candidates = candidates.filter(...)`
      calls into a single predicate pass. Build the predicate from the active
      filters once, then do a single traversal. Expected: O(9·N) → O(N) on
      empty-query requests where the candidate pool is the full
      `documentStore`

## Implementation Notes

- M9 option 1 requires a migration (backfill `mealTypes` for existing
  community recipes) — can be done in a one-shot script under `server/scripts/`.
- M22's single-predicate pattern should be documented as a perf pattern once
  proven — updates to `docs/patterns/performance.md`.
- Both changes should be benchmarked before + after to verify the perf
  claim (construct a synthetic 10k-recipe index and time searches).

## Related Audit Findings

M9, M22 (audit 2026-04-17)

## Updates

### 2026-04-17

- Created from audit #11 deferred Medium items
