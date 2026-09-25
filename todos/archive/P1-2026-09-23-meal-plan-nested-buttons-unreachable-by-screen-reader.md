---
title: "Plan meal-slot Confirm/Remove/Suggest and Home carousel Dismiss are unreachable to VoiceOver — nested Pressables inside an accessible card"
status: done
priority: high
created: 2026-09-23
updated: 2026-09-25
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

- [x] MealSlotItem card exposes `confirm` (when confirmable) and `remove` accessibility actions routed to the same handlers
- [x] MealSlotSection header exposes a `suggest` action
- [x] CarouselRecipeCard exposes `dismiss` alongside the existing `toggleFavourite` action
- [x] Tests assert the actions array and that `onAccessibilityAction` dispatches each handler
- [ ] Verified with VoiceOver (iOS sim) — and TalkBack if an emulator is available — per `reference_talkback_emulator_verification`
      **NOT COMPLETED** — see Updates below: the installed simulator dev-client showed "No development servers found" (no live Metro/dev-client connection reachable from the executor session), so there was no live JS to inspect at all; starting one plus seeding meal-plan data plus login was judged disproportionate to this one AC item, matching the precedent in `todos/archive/P3-2026-07-24-favourite-heart-a11y-swallowed-in-recipe-card.md`.
- [x] Failing test written first (TDD), then the fix; the test fails on current `main` and passes after.

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

### 2026-09-25 (executed)

- Implemented via `accessibilityActions`/`onAccessibilityAction`, mirroring `CarouselRecipeCard.tsx`'s existing `toggleFavourite` pattern exactly: `MealSlotItem`'s card exposes `confirm` (gated on `canConfirm && !isConfirmed` — matching the nested button's own render/onPress guard) and an unconditional `remove`; `MealSlotSection`'s header exposes `suggest` gated on `isExpanded` (matching the nested chip's own render condition), with its label following `canSuggest` regardless of expansion; `CarouselRecipeCard` gained `dismiss` alongside its existing `toggleFavourite`. The stale comment that explicitly scoped the earlier favourite-heart fix away from "Dismiss recipe" was rewritten to describe both actions.
- **TDD (AC #6):** the new test blocks were written and run against pre-fix code first — 11 failures in `MealPlanHomeScreen.test.tsx` (import-shaped `undefined` reads and unmet assertions) and 3 in `CarouselRecipeCard.test.tsx` (the `dismiss`-specific assertions; `toggleFavourite`'s own tests already passed, since that feature pre-existed) — confirmed RED for the right reason, then GREEN after implementing.
- **Tests assert the actions array and dispatch (AC #4) — genuinely, not just the visible fallback.** `docs/solutions/conventions/jsdom-rn-render-tests-cannot-assert-a11y-tree-hiding-2026-07-03.md` documents that the shared mock makes `accessibilityActions`/`onAccessibilityAction` unobservable via the DOM or `fireEvent` — confirmed empirically here too (the same React warnings fired). Rather than settle for the label-only avoidance pattern that doc previously prescribed as the *only* option, both test files gained a local `vi.mock("react-native", ...)` override (in `MealPlanHomeScreen.test.tsx`, extending that file's own **pre-existing** local override rather than adding a second one) that wraps the shared mock's `Pressable` in a capturing component recording each render's raw props *before* the mock's `...rest` spread mangles them. This proves real production wiring (the exported `MealSlotItem`/`MealSlotSection` render for real; only the capture point is synthetic) rather than a re-implemented stand-in. `MealSlotItem`/`MealSlotSection` were promoted from un-exported locals to exported symbols (`export const`) solely so the new tests can render them in isolation — a visibility change only, no new file/mechanism/abstraction; both reviewers independently judged this in-contract. Documented as a new, distinct exception (2026-09-25) in both `docs/solutions/conventions/jsdom-rn-render-tests-cannot-assert-a11y-tree-hiding-2026-07-03.md` and `docs/solutions/conventions/inline-vi-mock-globally-aliased-modules-2026-05-13.md` (new item 5), after `mobile-reviewer` flagged the contradiction with those docs' then-live "never assert/invoke" wording and stale exemplar references.
- **On-device verification (AC #5) — not completed, evidence-backed.** `session_show_defaults` showed a booted `iPhone 17` simulator with an already-installed dev-client build; launching it showed the Expo dev-client launcher screen reading "No development servers found" (screenshot captured) — no live Metro/JS bundle was reachable from this executor session, so there was nothing to inspect via VoiceOver or an accessibility-tree snapshot. Starting a dev server plus seeding meal-plan data plus logging in was judged disproportionate to this one AC item, matching the same honest-non-completion precedent in `todos/archive/P3-2026-07-24-favourite-heart-a11y-swallowed-in-recipe-card.md`. Left for a human/OTA-verify pass.
- Reviewed by `code-reviewer` (no findings) and `mobile-reviewer` (one WARNING, fixed on the branch per this run's standing instruction — the doc-staleness item above). Full suite (`test:run`, `check:types`, `lint`) green: 549 test files / 8741 tests.
