---
title: "Touch targets regressed to 32–36pt on Scan, Label analysis, Recipe browser and Plan after the June AAA sweep"
status: backlog
priority: medium
created: 2026-09-23
updated: 2026-09-23
assignee:
labels: [deferred, audit, accessibility]
github_issue:
---

# Touch targets regressed to 32–36pt on Scan, Label analysis, Recipe browser and Plan after the June AAA sweep

## Summary

Several controls fall below the 44pt / 48dp platform minimum again, even though `todos/archive/P3-2026-06-10-touch-targets-aaa-sweep.md` closed as done. They pass WCAG 2.5.8 AA (24px) but fail 2.5.5 AAA, Apple HIG and Material.

## Background

Found by the 2026-09-23 front-end audit (read-only, 6 lenses + Context7 research). Finding ID(s): **M13** in `docs/audits/2026-09-23-frontend.md` (local-only, gitignored). Each claim below was re-read against the code at HEAD `3df8b4b3`; line numbers may drift.

- `client/screens/ScanScreen.tsx:1128-1133` closeBtn 36×36 with no hitSlop; confirm buttons :1243-1256 have no minHeight (from L12).
- `client/screens/LabelAnalysisScreen.tsx:771-777` servings ± 36×36 with no hitSlop.
- `client/screens/meal-plan/RecipeBrowserScreen.tsx:281-294` favourite: 20pt + hitSlop 8 = 36pt.
- `client/screens/meal-plan/MealPlanHomeScreen.tsx:253-269` confirm 36pt; :290-297 remove 32pt.
- Research (RN Pressable hitSlop counts toward the target; WCAG 2.2): `confirmed`, with AA vs AAA framing. See `docs/rules/react-native.md:5`.

## Acceptance Criteria

- [ ] Every listed control has visual size + hitSlop ≥ 44pt on each axis (or explicit min 44)
- [ ] No visual layout regression (screenshots via verify-ui for Scan and LabelAnalysis)
- [ ] Consider a lint/pattern check to prevent regression, only if a cheap one fits the existing lint-staged checks
- [ ] Failing test written first (TDD), then the fix; the test fails on current `main` and passes after.

## Implementation Notes

The archived sweep's notes (hitSlop vs row-height caps) apply — read them first.

## Scope Contract

- **Mechanisms to use:** existing project patterns cited above — nothing new beyond what the acceptance criteria name.
- **Files in scope:**
  - `client/screens/ScanScreen.tsx`
  - `client/screens/LabelAnalysisScreen.tsx`
  - `client/screens/meal-plan/RecipeBrowserScreen.tsx`
  - `client/screens/meal-plan/MealPlanHomeScreen.tsx`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- hitSlop overlapping neighbouring controls in tight rows — check adjacent targets don't steal taps.

## Updates

### 2026-09-23

- Initial creation from the 2026-09-23 front-end audit (M13).
