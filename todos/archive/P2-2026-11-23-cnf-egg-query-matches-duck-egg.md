---
title: "CNF lookup matches a plain egg query to duck egg"
status: done
priority: medium
created: 2026-11-23
updated: 2026-11-28
assignee:
labels: [deferred, nutrition]
github_issue:
---

# CNF lookup matches a plain egg query to duck egg

## Summary

A photo of two chicken eggs is logged with duck egg nutrition, because the CNF matcher
picks "Egg, duck, whole, fresh, raw" for the lookup names "egg, whole, raw" and
"egg, whole, raw, fresh". A duck egg has roughly twice the calories of a chicken egg per
egg, so the logged numbers are too high.

## Background

Found on 2026-11-23 during the phone test of PR #1984 (meal photo in the Coach chat), on
both the Samsung and the iPhone. Server log, both runs:

- query `egg, whole, raw` → match `Egg, duck, whole, fresh, raw` (code 88)
- query `egg, whole, raw, fresh` → match `Egg, duck, whole, fresh, raw` (code 88)

Deferred because the CNF matcher is not changed by PR #1984 and the fix needs its own
look at how CNF lists chicken eggs ("Egg, chicken, whole, fresh or frozen, raw" or
similar) and why the duck row outranks it. The same lookup serves the Scan screen, so the
defect is not limited to the Coach photo.

Not measured: the CNF name of the chicken egg row, and the scores of the two rows.

## Acceptance Criteria

- [x] `fuzzyMatchCNF("egg, whole, raw")` and `fuzzyMatchCNF("egg, whole, raw, fresh")`
      return a chicken egg row, not the duck egg row
- [x] A query that names the species ("duck egg, raw") still returns the duck egg row
- [x] The committed CNF gold set in `nutrition-lookup.test.ts` gains these cases and has no
      regressions
- [x] `nutrition_cache` rows already stored for the two egg queries are dealt with (they
      hold the duck egg data until they expire)

## Implementation Notes

- Matcher: `fuzzyMatchCNF` / `scoreCNFMatch` in `server/services/cnf-lookup.ts`, word
  helpers in `server/services/food-query-words.ts`.
- Tests: `server/services/__tests__/nutrition-lookup.test.ts` ("fuzzyMatchCNF — committed
  gold set").
- First step is a measurement: list the CNF rows whose name starts with "Egg," and score
  each against the two queries, to see whether the chicken row loses on a word ("chicken",
  "frozen") or ties and loses on order.
- A general rule (an unqualified animal food means the common species) is preferable to a
  special case for eggs, if the measurement supports one.

## Scope Contract

- **Mechanisms to use:** the existing CNF scoring and its gold-set tests.
- **Files in scope:** `server/services/cnf-lookup.ts`, `server/services/food-query-words.ts`,
  `server/services/__tests__/nutrition-lookup.test.ts`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Risks

- A scoring change can shift other CNF matches; the gold set is the regression check.

## Updates

### 2026-11-23

- Initial creation (deferred finding from the PR #1984 phone test).

### 2026-11-28

- Measured on the real 5,690-row CNF EN list: the chicken row is
  "Egg, chicken, whole, fresh or frozen, raw" (code 125). It scored 17.59 against
  the duck row's 17.72 for "egg, whole, raw", losing on name length only (the
  words "chicken" and "or frozen"). "egg, raw" and "whole egg" also picked the
  duck row.
- Fix: a general rule in `scoreCNFMatch`. A qualifier part naming a less common
  species the query did not name (duck, goose, quail, turkey, goat, sheep) loses a
  point, the same shape as the dehydrated-form penalty. Gold set +3 entries, now
  right 55, wrong 11, no match 4, with no other gold query moved on the full list.
- Cache: `nutrition_cache` rows expire 7 days after they are written, so the
  duck egg rows are gone within a week of deploy. To clear them at once:
  `DELETE FROM nutrition_cache WHERE normalized_name = 'Egg, duck, whole, fresh, raw' AND query_key NOT LIKE '%duck%';`
- Not fixed, filed separately: "milk, whole" (see
  `todos/P3-2026-11-28-cnf-milk-whole-picks-flavoured-or-sheep-milk.md`).
