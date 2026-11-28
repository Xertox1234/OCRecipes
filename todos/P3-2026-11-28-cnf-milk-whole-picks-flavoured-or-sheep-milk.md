---
title: 'CNF lookup matches "milk, whole" to chocolate milk instead of plain whole milk'
status: backlog
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

- [ ] `fuzzyMatchCNF("milk, whole")` on the real list returns a plain cow's milk row
- [ ] "chocolate milk" still returns the chocolate row
- [ ] The committed CNF gold set gains the case, with no regressions

## Implementation Notes

- `scoreCNFMatch` in `server/services/cnf-lookup.ts`. A flavour word the query did not
  name ("chocolate", "strawberry") could lose a point in the same way the dehydrated-form
  and species rules do. Measure the whole list before choosing.

## Updates

### 2026-11-28

- Initial creation (deferred finding from the duck egg todo).
