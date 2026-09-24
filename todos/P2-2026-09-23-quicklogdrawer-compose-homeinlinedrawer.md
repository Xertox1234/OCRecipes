---
title: "QuickLogDrawer reimplements HomeInlineDrawer's header/chevron shell instead of composing it like its two siblings"
status: backlog
priority: medium
created: 2026-09-23
updated: 2026-09-23
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

- [ ] QuickLogDrawer's body renders inside `<HomeInlineDrawer>`; its own chevron/header/reduced-motion code is deleted
- [ ] Accessibility labels/states and the measure()/glide behavior are unchanged; existing Home drawer tests green
- [ ] Failing test written first (TDD), then the fix; the test fails on current `main` and passes after.

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
