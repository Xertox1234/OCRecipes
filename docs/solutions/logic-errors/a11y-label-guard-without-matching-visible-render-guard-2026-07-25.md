---
title: Guarding an empty value in the composed accessibilityLabel but not in the visible render fixes only half the bug
track: bug
category: logic-errors
tags: [accessibility, react-native, layout, empty-string, conditional-render, paired-surfaces, partial-fix]
module: client
applies_to: ["client/components/**/*.tsx", "client/screens/**/*.tsx"]
symptoms: ["A screen-reader label reads correctly but the same card shows an unexplained blank gap for sighted users", "An empty <Text> node renders with no content yet still occupies its marginBottom/height", "A follow-up PR re-fixes 'the same bug' in the same component days after it was declared fixed", "The a11y regression test passes while the visual defect is live"]
created: '2026-07-25'
severity: low
---

# Guarding an empty value in the composed accessibilityLabel but not in the visible render fixes only half the bug

## Problem

A component surfaces the same field **twice**: once folded into a composed
`accessibilityLabel` template literal, and once as a visible element. When that
field can be empty, both surfaces need the empty-guard — but the two live in
different parts of the file (the props block vs. the JSX body) and a fix aimed
at one does not visibly implicate the other.

`CarouselRecipeCard` composed its label as:

```tsx
accessibilityLabel={`…${card.title}${prepLabel ? `, ${prepLabel} prep` : ""}. ${card.recommendationReason}${allergenA11ySuffix}. Double tap to view recipe.`}
```

An empty `recommendationReason` produced `…prep. . Double tap…` — a dangling
double period. PR #711 fixed it with a conditional segment. Two days later the
**visible** half was still unguarded:

```tsx
<ThemedText type="caption" style={[styles.reason, …]} numberOfLines={1}>
  {card.recommendationReason}
</ThemedText>
```

An empty reason rendered a blank `<Text>` that still reserved its
`styles.reason` `marginBottom: Spacing.sm` — a sighted-only blank gap. Two PRs,
two days, one root cause.

## Symptoms

- Screen-reader output is correct; the visual has an unexplained empty band.
- An empty `<Text>` in the tree with no text content but real layout height.
- Git history shows a same-component "same bug" fix landing shortly after one
  that was believed complete.
- Test suites are green — the a11y regression test asserts the label string and
  never looks at what rendered.

## Root Cause

The empty-guard is applied where the bug was *reported*, not where the value is
*consumed*. A composed-label bug is reported by a screen-reader review; the
reviewer's lens is the label string, so the fix lands there. The visible render
consuming the same field is a separate expression, several dozen lines away, and
nothing mechanically links them.

React makes the visual half easy to miss: `{""}` renders nothing and throws no
warning, so the element looks absent. It isn't — the host `<Text>` still mounts
and its style still applies. In React Native this is worse than on web, because
margins do not collapse in Yoga, so an empty node's `marginBottom` is
unconditionally real space.

The a11y half is also the *louder* half: an empty string in a template literal
produces visible punctuation damage (`. .`), while the visual half degrades
silently into whitespace nobody files a bug about.

## Solution

Guard **every** consumer of the field in the same change. Use the conditional
idiom already present in the file rather than inventing a helper:

```tsx
{card.recommendationReason ? (
  <ThemedText
    testID="carousel-card-reason"
    type="caption"
    style={[styles.reason, { color: theme.textSecondary }]}
    numberOfLines={1}
  >
    {card.recommendationReason}
  </ThemedText>
) : null}
```

`CarouselRecipeCard` already used `showActions ? (…) : null` and
`prepLabel ? (…) : null`; matching them keeps the diff one expression wide. Do
**not** extract a shared `joinNonEmpty()`/`renderIfPresent()` helper for this —
it reads cleaner but converts a one-line guard into a new abstraction, and the
codebase's other conditional segments would then be inconsistent with it.

Add the `testID` in the same change: without it, the absence assertion has no
selector and cannot be written (see See Also).

## Prevention

- **When a review finds an empty-value bug in a composed `accessibilityLabel`,
  grep the same component for other consumers of that field before closing.**
  One `grep -n "<fieldName>" <component>` answers it. In `CarouselRecipeCard`
  the field appeared on exactly two lines — 147 (the label) and 255 (the
  caption).
- Prefer a sibling component with no matching occurrence as *confirmation*, not
  as a reason to skip the check — `FavouriteRecipesScreen`,
  `MealPlanHomeScreen`, `CookbookDetailScreen`, `RecipeBrowserScreen`, and
  `MenuScanResultScreen` were all clean here; the duplicate was inside the same
  file.
- When removing an empty node that was implicitly supplying spacing, check what
  the layout collapses to. Here, with the caption and `RecipeAllergenLabel` both
  absent, the title sits `marginBottom: 2` above the action row. That was
  accepted deliberately — the alternative (moving `Spacing.sm` onto the title)
  changes the populated case too. **Restoring the empty `<Text>` to hold the gap
  is never the answer**; it is the defect.

## Related Files

- `client/components/home/CarouselRecipeCard.tsx` — both consumers: the composed
  label and the caption
- `client/components/home/__tests__/CarouselRecipeCard.test.tsx` — the
  `empty recommendationReason` describe block, covering both halves
- `client/components/meal-plan/recipe-discovery-utils.ts` — `toCarouselCard`,
  whose fallback chain terminates at `recipe.cuisine ?? ""` and makes the empty
  state genuinely reachable

## See Also

- [duplicated flag-composition desyncs display surfaces](duplicated-flag-composition-desyncs-display-surfaces-2026-07-24.md) — the inter-component sibling of this bug: one derived value, two files, only one updated
- [derived label gated to the flow that populates its state](derived-label-gated-to-flow-that-populates-its-state-2026-07-17.md) — the other way a caption renders from a value its producer never populated
- [../conventions/jsdom-rn-render-tests-cannot-assert-a11y-tree-hiding-2026-07-03.md](../conventions/jsdom-rn-render-tests-cannot-assert-a11y-tree-hiding-2026-07-03.md) — how to assert both halves in the jsdom harness, and why an absence assertion needs a paired presence assertion
