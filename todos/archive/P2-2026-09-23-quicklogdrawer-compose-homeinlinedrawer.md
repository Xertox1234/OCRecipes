---
title: "QuickLogDrawer reimplements HomeInlineDrawer's header/chevron shell instead of composing it like its two siblings"
status: done
priority: medium
created: 2026-09-23
updated: 2026-09-25
assignee:
labels: [deferred, audit, maintainability]
github_issue:
---

# QuickLogDrawer reimplements HomeInlineDrawer's header/chevron shell instead of composing it like its two siblings

## Summary

HomeScreen renders RecipeSearchDrawer and GenerateRecipeDrawer inside `<HomeInlineDrawer>`, while QuickLogDrawer carries its own copy of the chevron shared value, reduced-motion effect and header Pressable (about 65–70 duplicated lines).

## Background

Found by the 2026-09-23 front-end audit (read-only, 6 lenses + Context7 research). Finding ID(s): **M22** in `docs/audits/2026-09-23-frontend.md` (local-only, gitignored). Each claim below was re-read against the code at HEAD `3df8b4b3`; line numbers may drift.

- `client/components/home/QuickLogDrawer.tsx:191-267` vs `client/components/home/HomeInlineDrawer.tsx:47-113`; composed usage at `client/screens/HomeScreen.tsx:340-367`.

## Acceptance Criteria

- [x] QuickLogDrawer's body renders inside `<HomeInlineDrawer>`; its own chevron/header/reduced-motion code is deleted
- [x] Accessibility labels/states and the measure()/glide behavior are unchanged; existing Home drawer tests green
- [x] Failing test written first (TDD), then the fix; the test fails on current `main` and passes after.

## Implementation Notes

Watch the ref/measure comment at HomeScreen.tsx:345-348 — HomeInlineDrawer has no ref by design.

## Scope Contract

- **Mechanisms to use:** existing project patterns cited above — nothing new beyond what the acceptance criteria name.
- **Files in scope:**
  - `client/components/home/QuickLogDrawer.tsx`
  - `client/components/home/HomeInlineDrawer.tsx (only if a prop is missing)`
  - `client/screens/HomeScreen.tsx`
  - matching `__tests__/`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- QuickLogDrawer has a reset-during-submit issue tracked in a P3 todo — can be done together if convenient.

## Updates

### 2026-09-23

- Initial creation from the 2026-09-23 front-end audit (M22).

### 2026-09-25

- Implemented: QuickLogDrawer now composes `<HomeInlineDrawer>` for its header/chevron/reduced-motion
  shell instead of duplicating it; `HomeInlineDrawer` gained one new optional prop,
  `bodyBackgroundColor`, so QuickLogDrawer keeps its `withOpacity(theme.link, 0.04)` tint (the
  Scope Contract's "only if a prop is missing" carve-out).
- Review (round 1) caught a real CRITICAL: composing forced a `maxHeight` clamp onto QuickLogDrawer
  that the pre-refactor component never had. Unlike its siblings (RecipeSearchDrawer,
  GenerateRecipeDrawer), QuickLogDrawer's parsed-items list is unbounded before submit
  (`MAX_LOG_ITEMS` only caps at submit time), so the clamp could silently clip trailing rows and
  the Log All button on small devices once a dictated log exceeded roughly a dozen items. Fixed by
  making `HomeInlineDrawer.maxHeight` optional and not passing it from QuickLogDrawer/HomeScreen,
  restoring the exact pre-refactor unclamped behavior. Round-2 confirmation review: no findings.
- TDD test added: `QuickLogDrawer.test.tsx` — "composes HomeInlineDrawer for its header/chevron
  shell instead of reimplementing it" (spies on the real `HomeInlineDrawer` via
  `vi.fn(actual.HomeInlineDrawer)`, verified red on pre-refactor `main`, green after).
