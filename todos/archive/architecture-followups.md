---
title: "Architecture Followups — Inverted Dep + Route Split"
status: in-progress
priority: low
created: 2026-04-17
updated: 2026-04-17
assignee:
labels: [architecture, audit-followup]
---

# Architecture Followups

## Summary

Two architectural cleanups surfaced in audit 2026-04-17 that didn't block
any High fix but are worth addressing before the code compounds: `MealPlanDay`
type is defined in coach-blocks schema (inverted dep), and `recipes.ts` route
file has grown to 1,026 LOC mixing 4 distinct resource concerns.

## Background

M16 and L18 from audit 2026-04-17. Neither is urgent — they don't cause
bugs — but they set bad precedent as the codebase grows.

## Acceptance Criteria

- [ ] **M16** Move `MealPlanDay` canonical definition from
      `shared/schemas/coach-blocks.ts:206` to a new
      `shared/schemas/meal-plan.ts` (or `shared/types/meal-plan.ts`).
      Update `shared/types/meal-plan.ts` to import from there, and have
      `coach-blocks.ts` reference it. This flips the dependency:
      Plan (foundational) no longer depends on Coach (downstream).
- [ ] **L18** Split `server/routes/recipes.ts` (1,026 LOC, 4 concerns) into:
      - `server/routes/recipes.ts` — community CRUD only
      - `server/routes/recipe-search.ts` — `/api/recipes/search` (MiniSearch)
      - `server/routes/recipe-catalog.ts` — Spoonacular endpoints
      - `server/routes/recipe-import.ts` — URL-import endpoints

      Update `server/routes.ts` registration. Each split file should stay
      under 400 LOC.

## Implementation Notes

- M16 is a pure type-system refactor — zero runtime risk, just trace all
  import paths.
- L18 should come with a small audit of any cross-file helper functions
  that will need to become shared imports (currently accessible as
  same-file closures). Extract to `_helpers.ts` or a new
  `server/routes/_recipe-helpers.ts` if the usage crosses files.
- Consider the grep-ability trade-off: one big file is easier to full-text
  search; four small files are easier to navigate. The split is correct
  architecturally but expect some friction before muscle memory adjusts.

## Related Audit Findings

M16, L18 (audit 2026-04-17)

## Updates

### 2026-04-17
- Created from audit #11 deferred Medium/Low items
