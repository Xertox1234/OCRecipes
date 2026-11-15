---
title: "Coach food card accepts implausible per-unit macros from lookup (large egg 55 cal / 10.7 g protein / 0 g fat)"
status: backlog
priority: medium
created: 2026-11-09
updated: 2026-11-09
assignee:
labels: [deferred, nutrition]
github_issue:
---

# Coach food card accepts implausible per-unit macros from lookup

## Summary

In the PR #1812 simulator check, "I had two eggs…" produced a food card whose "large egg" line came from lookup at 55 cal, 10.7 g protein, 0 g fat per egg, and that is what got logged. A real large egg is about 72 cal, 6 g protein and 5 g fat.

## Background

The macros are internally inconsistent: 10.7 g protein alone is about 43 cal, and fat is 0. Even so, the line passed the 3× plausibility check, because that check compares calories only. The card was deferred from #1812 because the lookup data is outside that PR's scope.

## Acceptance Criteria

- [ ] Find which lookup source and serving conversion produced these numbers for "large egg" (unit "egg").
- [ ] Add a plausibility guard: when 4·protein + 4·carbs + 9·fat is far from the calories, the per-unit macros are rejected or flagged as an estimate. Test it with the egg values above.
- [ ] Add a regression test showing "large egg" resolves to roughly 70 cal and 6 g protein.

## Implementation Notes

- `server/services/write-cards/enrich.ts` (per-unit lookup and plausibility check).
- `shared/lib/coach-write-card-math.ts`
- `server/services/food-nlp.ts`
- The lookup source is the one the food card's `source: "lookup"` path calls.
