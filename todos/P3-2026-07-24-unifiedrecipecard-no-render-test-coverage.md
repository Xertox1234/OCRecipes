---
title: "UnifiedRecipeCard (RecipeBrowserScreen) has zero render-test coverage"
status: backlog
priority: low
created: 2026-07-24
updated: 2026-07-24
assignee:
labels: [deferred, client, testing]
github_issue:
---

# UnifiedRecipeCard (RecipeBrowserScreen) has zero render-test coverage

## Summary

`UnifiedRecipeCard` in `client/screens/meal-plan/RecipeBrowserScreen.tsx` has
no render test, unlike its two sibling recipe-card components
(`CarouselRecipeCard`, and the inline card in `FavouriteRecipesScreen`), which
both got composed-label + visible-Pressable regression tests. This includes
the safety-relevant allergen-suffix label composition from PR #696
(`client/screens/meal-plan/RecipeBrowserScreen.tsx:225`), which currently has
zero automated coverage.

## Background

Surfaced independently by both `code-reviewer` and `mobile-reviewer` during
the review of the favourite-heart accessibility fix
(`todos/archive/P3-2026-07-24-favourite-heart-a11y-swallowed-in-recipe-card.md`).
That fix added render tests to `CarouselRecipeCard.tsx` and
`FavouriteRecipesScreen.tsx` (the two other files it touched) but not to
`RecipeBrowserScreen.tsx` — the todo's primary named file.

The gap has a concrete technical cause, not just an oversight: `UnifiedRecipeCard`
is defined but not exported from `RecipeBrowserScreen.tsx`, so testing it in
isolation requires either (a) exporting it and accepting that importing the
file still evaluates every one of `RecipeBrowserScreen.tsx`'s ~30 top-level
imports (search hooks, `BottomSheetModal`, premium/IAP-adjacent context,
catalog search, etc.), or (b) rendering the full screen. Attempt (a) was tried
during the favourite-heart fix: exporting `UnifiedRecipeCard` and importing it
in a new test file failed with `SyntaxError: Unexpected token 'typeof'` —
some transitive import in that large dependency graph pulls in the REAL
`react-native` package (bypassing the `test/mocks/react-native.ts` alias,
likely via a deep subpath import like `react-native/Libraries/...` that the
exact-match Vite alias doesn't catch) rather than the jsdom-safe mock. Finding
and neutralizing the exact culprit import was deemed disproportionate effort
for that P3 todo and was reverted; this todo picks that investigation back up
as its own scoped unit of work.

## Acceptance Criteria

- [ ] `UnifiedRecipeCard` is exported from `RecipeBrowserScreen.tsx` (or
      otherwise testable in isolation).
- [ ] A new render test file (e.g.
      `client/screens/meal-plan/__tests__/RecipeBrowserScreen.test.tsx`)
      renders `UnifiedRecipeCard` in jsdom without the `SyntaxError: Unexpected
    token 'typeof'` failure — i.e. the culprit deep/transitive import of the
      real `react-native` package is identified and neutralized (via an
      additional `vi.mock`, a narrower import, or a vitest alias fix).
- [ ] The new test asserts, at minimum: the composed `accessibilityLabel`
      (base label + PR #696 allergen suffix) is exactly correct for at least
      one case with allergens present and one without; and the visible
      favourite Pressable's own label/role/`onPress` still fire correctly
      (mirroring the pattern already used in `CarouselRecipeCard.test.tsx`
      and `FavouriteRecipesScreen.test.tsx`).
- [ ] `npm run test:run`, `npm run check:types`, and `npm run lint` all pass.

## Implementation Notes

- Start by bisecting `RecipeBrowserScreen.tsx`'s import list (or running the
  file through `vite-node` with the same `vitest.config.ts` — see the reverted
  scratch probe technique in the favourite-heart todo's session for how to get
  a real stack trace naming the failing module) to find which import pulls in
  real `react-native`. Likely suspects: `@/hooks/useCatalogConfig`,
  `@/context/PremiumContext`, or another IAP-adjacent hook — these are the
  parts of the screen's dependency graph `CarouselRecipeCard.tsx` and
  `FavouriteRecipesScreen.tsx` don't have.
- Once found, either add a `vi.mock(...)` for that specific module (matching
  the existing `NutritionDetailScreen.test.tsx` / `FavouriteRecipesScreen.test.tsx`
  precedent of mocking a screen's data hooks directly), or — if it's a
  `react-native` deep-subpath import — consider whether `vitest.config.ts`'s
  `resolve.alias` for `"react-native"` should be widened (e.g. a regex alias)
  to also catch subpath imports; discuss the tradeoffs before changing a
  shared test-infra file used by 470+ other test files.
- Reuse the `renderComponent` harness (`test/utils/render-component.tsx`) and
  the `@vitest-environment jsdom` pattern already used across the codebase.

## Scope Contract

- **Mechanisms to use:** existing render-test harness (`renderComponent`,
  `@testing-library/react`, `vi.mock`); no new test utilities or libraries.
- **Files in scope:** `client/screens/meal-plan/RecipeBrowserScreen.tsx`
  (export change only), a new test file under
  `client/screens/meal-plan/__tests__/`, and — only if determined necessary
  after investigation — a scoped addition to `vitest.config.ts`'s existing
  `resolve.alias` block.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Risks

- Widening the `react-native` alias (if that turns out to be the fix) touches
  shared test infrastructure used by the whole suite — verify the full suite
  still passes, not just the new test file.

## Updates

### 2026-07-24

- Filed from the favourite-heart a11y fix's code review (both `code-reviewer`
  and `mobile-reviewer` independently flagged the coverage asymmetry).
