---
title: 'CNF lookup matches "milk, whole" to chocolate milk instead of plain whole milk'
status: done
priority: low
created: 2026-11-28
updated: 2026-11-28
assignee:
labels: [deferred, nutrition]
github_issue:
---

# CNF lookup matches "milk, whole" to chocolate milk instead of plain whole milk

## Summary

On the real CNF EN list, `fuzzyMatchCNF("milk, whole")` returned "Milk, fluid, sheep,
whole" before the duck egg fix. It now returns "Milk, fluid, chocolate, whole". The plain
cow's milk row, "Milk, fluid, whole, pasteurized, homogenized, 3.25% M.F." (code 113),
loses to both on length and on the many-parts penalty, because its name has six comma parts.

## Background

Found on 2026-11-28 while measuring the duck egg fix
(`todos/archive/P2-2026-11-23-cnf-egg-query-matches-duck-egg.md`). That fix made a
less common species the query did not name lose a point. It moved "milk, whole" off
the sheep row and onto the chocolate row, which is an unasked flavour. Measured scores
in a five-row subset after the fix: sheep 17.25, cow 16.94.

## Acceptance Criteria

- [x] `fuzzyMatchCNF("milk, whole")` on the real list returns a plain cow's milk row
- [x] "chocolate milk" still returns the chocolate row (see the update: it returns a chocolate milk shake on the real list, before and after; "milk, chocolate, whole" returns the chocolate milk row)
- [x] The committed CNF gold set gains the case, with no regressions

## Implementation Notes

- `scoreCNFMatch` in `server/services/cnf-lookup.ts`. A flavour word the query did not
  name ("chocolate", "strawberry") could lose a point in the same way the dehydrated-form
  and species rules do. Measure the whole list before choosing.

## Updates

### 2026-11-28

- Initial creation (deferred finding from the duck egg todo).

### 2026-11-28 (fix)

- Measured on the real list, the rows scoring above the plain cow's milk row for
  "milk, whole" were: chocolate (18.21), malted milk powder (17.94), dry whole (17.85),
  then the cow "producer" row (17.61), with buttermilk at 17.60.
- Fix in `scoreCNFMatch`, each measured on about 150 real-list queries:
  - an unasked flavour (chocolate, strawberry, malted, flavour/flavoured) on a row whose
    head is the queried food loses a point. Category heads are exempt, because under
    "Dessert, frozen, ice cream, …" every sibling names a flavour, and a penalty there moved
    bare "ice cream" to "Ice cream cone". "vanilla" is left out as the plain default;
  - "buttermilk" joins the species words, without which the margin over buttermilk was 0.01;
  - the dehydrated-form penalty is 2 points, not 1, or "Milk, dry whole" still won.
- Result: "milk, whole" picks "Milk, fluid, whole, producer, 3.7% M.F." by 0.36. The gold
  set is right 56, wrong 11, no match 4, and no other measured query moved.
- Not fixed: "whole milk" (in that word order) still picks the chocolate row. "chocolate
  milk" picks "Milk shake, chocolate, thick" on the real list, the same as before this fix.
