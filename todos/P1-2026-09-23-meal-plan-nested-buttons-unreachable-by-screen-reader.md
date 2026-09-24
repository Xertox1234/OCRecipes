---
title: "Plan meal-slot Confirm/Remove/Suggest and Home carousel Dismiss are unreachable to VoiceOver — nested Pressables inside an accessible card"
status: backlog
priority: high
created: 2026-09-23
updated: 2026-09-23
assignee:
labels: [deferred, audit, accessibility]
github_issue:
---

# Plan meal-slot Confirm/Remove/Suggest and Home carousel Dismiss are unreachable to VoiceOver — nested Pressables inside an accessible card

## Summary

A VoiceOver user cannot mark a planned meal as eaten, remove it, or request an AI suggestion on the Plan tab, and cannot dismiss a Home carousel recipe: each control is a Pressable nested inside an accessible card Pressable that collapses its subtree into one focus stop.

## Background

Found by the 2026-09-23 front-end audit (read-only, 6 lenses + Context7 research). Finding ID(s): **H2, M8** in `docs/audits/2026-09-23-frontend.md` (local-only, gitignored). Each claim below was re-read against the code at HEAD `3df8b4b3`; line numbers may drift.

- `MealPlanHomeScreen.tsx:238-298` (`MealSlotItem`): nested "Confirm X as eaten" (:253-269) and "Remove X" (:290-297). The file's own comment (:224-230) states the card collapses its subtree. The row's `SwipeableRow` fallback buttons only render under Reduce Motion (`SwipeableRow.tsx:106-119`), not when a screen reader is on.
- `MealPlanHomeScreen.tsx:350-414` (`MealSlotSection` header): nested "AI suggest {meal}" button.
- `CarouselRecipeCard.tsx:294-310`: "Dismiss recipe" — the comment at :96-101 explicitly left it out of the favourite-heart fix's scope.
- The fix shape already exists: `CarouselRecipeCard.tsx:102-124` (`accessibilityActions` + `onAccessibilityAction` for toggleFavourite), `RecipeBrowserScreen` `UnifiedRecipeCard`. Precedent: `todos/archive/P3-2026-07-24-favourite-heart-a11y-swallowed-in-recipe-card.md`, `docs/solutions/logic-errors/toast-action-button-unreachable-by-screen-reader-2026-07-13.md`.
- Research (RN 0.81 Accessibility → `accessible`, Accessibility Actions): `confirmed`. Android collapse behavior for a bare Pressable is not device-verified.

## Acceptance Criteria

- [ ] MealSlotItem card exposes `confirm` (when confirmable) and `remove` accessibility actions routed to the same handlers
- [ ] MealSlotSection header exposes a `suggest` action
- [ ] CarouselRecipeCard exposes `dismiss` alongside the existing `toggleFavourite` action
- [ ] Tests assert the actions array and that `onAccessibilityAction` dispatches each handler
- [ ] Verified with VoiceOver (iOS sim) — and TalkBack if an emulator is available — per `reference_talkback_emulator_verification`
- [ ] Failing test written first (TDD), then the fix; the test fails on current `main` and passes after.

## Implementation Notes

Mirror `CarouselRecipeCard.tsx:102-124` exactly. Do not hoist the nested buttons out of the card (changes layout) unless the actions approach proves insufficient on-device.

## Scope Contract

- **Mechanisms to use:** existing project patterns cited above — nothing new beyond what the acceptance criteria name.
- **Files in scope:**
  - `client/screens/meal-plan/MealPlanHomeScreen.tsx`
  - `client/components/home/CarouselRecipeCard.tsx`
  - matching `__tests__/`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- MealPlanHomeScreen is also touched by the sheet-consolidation and unstable-deps todos — sequence to avoid collisions.

## Updates

### 2026-09-23

- Initial creation from the 2026-09-23 front-end audit (H2, M8).
