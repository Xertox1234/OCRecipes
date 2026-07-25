---
title: "CarouselRecipeCard composed a11y label has a double period when recommendationReason is empty"
status: backlog
priority: low
created: 2026-07-24
updated: 2026-07-24
assignee:
labels: [deferred, client, accessibility]
github_issue:
---

# CarouselRecipeCard composed a11y label has a double period when recommendationReason is empty

## Summary

`client/components/home/CarouselRecipeCard.tsx`'s composed `accessibilityLabel`
template always inserts a literal `. ` before `card.recommendationReason`. When
`recommendationReason` is an empty string (a possible `toCarouselCard` output
when no calories/time/cuisine signal is available), the label reads
`...prep. . Double tap to view recipe.` — a double period.

## Background

Found by `mobile-reviewer` while reviewing
`todos/archive/P3-2026-07-24-universal-allergen-label-remaining-surfaces.md`
(the universal allergen label todo, which added a `${allergenA11ySuffix}`
segment right after `recommendationReason`). The double-period bug **predates**
that change and is not caused by it — confirmed pre-existing in
`client/components/home/CarouselRecipeCard.tsx`'s
`accessibilityLabel={...}` template. When both an empty `recommendationReason`
and a non-empty allergen suffix coincide, the glitch compounds slightly
(`...prep. . Contains Peanuts. Double tap...`), which is how it surfaced during
that review, but the root cause is independent of allergens.

## Acceptance Criteria

- [ ] `CarouselRecipeCard`'s composed `accessibilityLabel` never contains a
      double period when `recommendationReason` is an empty string.
- [ ] Existing `client/components/home/__tests__/CarouselRecipeCard.test.tsx`
      assertions (remix/curated/allergen label composition) keep passing.
- [ ] Add a regression test asserting the label reads correctly (single
      punctuation, no dangling ". .") when `recommendationReason` is `""`.

## Implementation Notes

- The composed label lives in `client/components/home/CarouselRecipeCard.tsx`,
  in the `AnimatedPressable`'s `accessibilityLabel` template literal.
- `recommendationReason` can be empty when `toCarouselCard`
  (`client/components/meal-plan/recipe-discovery-utils.ts`) falls through all
  of its calorie/time/cuisine branches — see that function's fallback chain.
- Likely fix: only emit the `. ${card.recommendationReason}` segment when
  `card.recommendationReason` is non-empty, mirroring how `prepLabel` and the
  allergen suffix are already conditionally included.

## Scope Contract

- **Mechanisms to use:** a conditional guard on the existing template literal
  segment — no new component, no new prop.
- **Files in scope:** `client/components/home/CarouselRecipeCard.tsx` and its
  test file.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Risks

- Low risk, cosmetic/a11y-string-quality issue — no functional or safety
  impact (unlike the fail-dangerous allergen invariant).

## Updates

### 2026-07-24

- Filed from `mobile-reviewer`'s SUGGESTION during review of
  `todos/archive/P3-2026-07-24-universal-allergen-label-remaining-surfaces.md`.
  Pre-existing, low severity — not fixed inline to keep that PR's diff scoped
  to the allergen-label feature.
