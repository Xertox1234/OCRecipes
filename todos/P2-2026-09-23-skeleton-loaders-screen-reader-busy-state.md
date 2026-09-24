---
title: 'Skeleton loaders give screen readers no loading signal — the iOS-hidden container hides its own "Loading" label, and Android hides nothing'
status: backlog
priority: medium
created: 2026-09-23
updated: 2026-09-23
assignee:
labels: [deferred, audit, accessibility]
github_issue:
---

# Skeleton loaders give screen readers no loading signal — the iOS-hidden container hides its own "Loading" label, and Android hides nothing

## Summary

Five loading skeletons put `accessibilityLabel="Loading..."` and `accessibilityElementsHidden` on the same view, so iOS hides the label along with the boxes. Android lacks `no-hide-descendants`, so TalkBack can focus each decorative box. `SkeletonItem` has a label only.

## Background

Found by the 2026-09-23 front-end audit (read-only, 6 lenses + Context7 research). Finding ID(s): **M15** in `docs/audits/2026-09-23-frontend.md` (local-only, gitignored). Each claim below was re-read against the code at HEAD `3df8b4b3`; line numbers may drift.

- `client/screens/meal-plan/MealPlanHomeScreen.tsx:1211-1216`, `client/screens/meal-plan/RecipeBrowserScreen.tsx:944-948`, `client/screens/CoachProScreen.tsx:157-161`, `client/screens/PhotoAnalysisScreen.tsx:~415`, `client/components/SkeletonLoader.tsx:342-354`.
- Reference implementation: `NutritionDetailScreen.tsx:76-91`.
- Research (RN `accessibilityElementsHidden` iOS-only; `importantForAccessibility`): `better-fix`. Make the container a single accessible element with a "Loading" label and `accessibilityState={{ busy: true }}` (or role progressbar) so the boxes are grouped away on both platforms.

## Acceptance Criteria

- [ ] Each skeleton container is one accessible element announcing loading on both platforms; decorative boxes are not individually focusable
- [ ] Prefer fixing inside `SkeletonLoader.tsx` so call sites inherit the behavior; update any call sites that hand-roll the container
- [ ] Tests assert the container props
- [ ] Failing test written first (TDD), then the fix; the test fails on current `main` and passes after.

## Implementation Notes

Check how `NutritionDetailScreen` pairs its props and match that.

## Scope Contract

- **Mechanisms to use:** existing project patterns cited above — nothing new beyond what the acceptance criteria name.
- **Files in scope:**
  - `client/components/SkeletonLoader.tsx`
  - `client/screens/meal-plan/MealPlanHomeScreen.tsx`
  - `client/screens/meal-plan/RecipeBrowserScreen.tsx`
  - `client/screens/CoachProScreen.tsx`
  - `client/screens/PhotoAnalysisScreen.tsx`
  - matching `__tests__/`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- None significant.

## Updates

### 2026-09-23

- Initial creation from the 2026-09-23 front-end audit (M15).
