---
title: "Coach food card accepts implausible per-unit macros from lookup (large egg 55 cal / 10.7 g protein / 0 g fat)"
status: done
priority: medium
created: 2026-11-09
updated: 2026-11-15
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

- [x] Find which lookup source and serving conversion produced these numbers for "large egg" (unit "egg").
- [x] Add a plausibility guard: when 4·protein + 4·carbs + 9·fat is far from the calories, the per-unit macros are rejected or flagged as an estimate. Test it with the egg values above.
- [x] Add a regression test showing "large egg" resolves to roughly 70 cal and 6 g protein.

## Implementation Notes

- `server/services/write-cards/enrich.ts` (per-unit lookup and plausibility check).
- `shared/lib/coach-write-card-math.ts`
- `server/services/food-nlp.ts`
- The lookup source is the one the food card's `source: "lookup"` path calls.

## Updates

### 2026-11-15

- Source found: the card asked the lookup for "1 egg large egg"; USDA answered "Eggs, Grade A, Large, egg white" per 100 g (55 cal, 10.7 g protein, 2.36 g carbs, 0 g fat), and the card used those per-100 g values as one egg. CNF and USDA answer every text query per 100 g, so no card line was ever converted to its unit.
- Fix: a lookup is used only when the unit states its weight ("100 g", "cup (240 g)") and is scaled to it; a counted unit keeps the coach's estimate. A lookup must also agree with the estimate's protein/carbs/fat split.
- The 4/4/9 energy check was added as asked, but it does not reject the egg row: with its carbs the row adds up to 52 cal against 55. The macro-split check is what rejects it.
- Not done: giving the coach tool a per-unit weight so counted units ("egg", "slice") can use a lookup again. That changes the tool the model sees; owner decision.
