---
title: "LabelAnalysisScreen scales nutrition values by servings inline three times, with two rounding conventions"
status: backlog
priority: medium
created: 2026-09-23
updated: 2026-09-23
assignee:
labels: [deferred, audit, maintainability]
github_issue:
---

# LabelAnalysisScreen scales nutrition values by servings inline three times, with two rounding conventions

## Summary

LabelAnalysisScreen multiplies by `servings` inline at three sites, using `Math.round(x)` in one place and `Math.round(x*10)/10` in two. Nothing shares the logic, which duplicates what `recalculateNutrition` already does in `useNutritionLookup`.

## Background

Found by the 2026-09-23 front-end audit (read-only, 6 lenses + Context7 research). Finding ID(s): **M25** in `docs/audits/2026-09-23-frontend.md` (local-only, gitignored). Each claim below was re-read against the code at HEAD `3df8b4b3`; line numbers may drift.

- `client/screens/LabelAnalysisScreen.tsx:309, 464, 535`; compare `useNutritionLookup.ts:328` `recalculateNutrition`, `client/screens/meal-plan/meal-plan-utils.ts`.

## Acceptance Criteria

- [ ] One tested scaling helper is used at all three sites, with the rounding convention made explicit
- [ ] Evaluate (and note) whether to share with `recalculateNutrition`
- [ ] Failing test written first (TDD), then the fix; the test fails on current `main` and passes after.

## Implementation Notes

Keep it small — a pure util with tests.

## Scope Contract

- **Mechanisms to use:** existing project patterns cited above — nothing new beyond what the acceptance criteria name.
- **Files in scope:**
  - `client/screens/LabelAnalysisScreen.tsx`
  - a -utils.ts next to it
  - matching `__tests__/`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- Changing rounding could shift displayed values by 0.1 — keep the current per-site behavior unless deliberately unifying.

## Updates

### 2026-09-23

- Initial creation from the 2026-09-23 front-end audit (M25).
