---
title: "removeClippedSubviews hides off-screen carousel cards from VoiceOver — clipped cells are not in the accessibility tree, and an omitted prop still clips on Android"
track: bug
category: logic-errors
tags: [accessibility, react-native, performance]
module: client
applies_to: ["client/components/**/*.tsx", "client/screens/**/*.tsx"]
symptoms: ["VoiceOver reads the same carousel card again on every swipe, or never reaches the third card", "An accessibility-tree dump shows only the visible card and the one peeking in; more cards appear only after a manual scroll", "A sibling row without clipping exposes all its off-screen items, while the clipped row does not"]
created: 2026-10-23
severity: medium
---

# removeClippedSubviews hides off-screen carousel cards from VoiceOver

## Problem

The For You and Curated Recipes rows on Home, and the meal-plan preset rows,
set `removeClippedSubviews` on their horizontal `FlatList`. With it on, iOS
detaches every cell outside the viewport from the native view tree. VoiceOver
walks the native tree, so it can reach the visible card and the one peeking
in, and nothing after that. The owner's device pass reported focus "reading the
same card over and over" on For You.

## Symptoms

- AXe `describe-ui` on Home listed two For You cards out of eight, and two
  Curated cards out of up to twenty. Card 3 appeared only after a manual swipe.
- On the same screen, `DiscoveryCarousel` (no clipping) listed every one of its
  cards, including ones thousands of points off-screen. That pair is the
  control: the prop is the only difference.

## Root Cause

`removeClippedSubviews` removes off-screen children "from their native backing
superview" (RN FlatList/ScrollView docs, which warn of "missing content, mainly
observed on iOS"). A view that isn't attached isn't an accessibility element,
so VoiceOver can't focus it or scroll to it. RN maintainers tied this to
VoiceOver focus not moving to unrendered list elements (facebook/react-native
#12374, discussed in PR #12944).

The project rule "every FlatList spreads `FLATLIST_DEFAULTS`" sets the prop to
`true`, which is what pushed short carousels into it.

## Solution

On horizontal carousels and other short, capped lists, pass
`removeClippedSubviews={false}` **explicitly** and keep `windowSize` and
`getItemLayout`. Deleting the prop is not enough. `FlatList.js`'s
`removeClippedSubviewsOrDefault` returns `removeClippedSubviews ?? Platform.OS === 'android'`
(or `?? true` when the `shouldUseRemoveClippedSubviewsAsDefaultOnIOS` flag is
on), so an omitted prop still clips on Android and would on iOS if the flag
flips.

After the fix, For You exposed 8/8 cards without scrolling, and Curated exposed
10, which is FlatList's default `initialNumToRender`. The rest mount as the
list scrolls.

## Prevention

- Test it by capturing the `FlatList` props through a file-scoped
  `vi.mock("react-native")` override, and assert `toBe(false)`. `toBeFalsy()`
  passes for an omitted prop, which still clips on Android.
- Verify with an accessibility-tree dump (AXe `describe-ui`), not the XcodeBuildMCP
  snapshot, which also omits off-screen elements and can't tell clipped from
  merely off-screen.
- Clipping saves little: the docs note detached views are not deallocated.
  Keep it only on long vertical lists, where the rule's defaults apply.

## Related Files

- `client/components/home/RecipeCarousel.tsx`
- `client/components/home/CuratedRecipeCarousel.tsx`
- `client/components/meal-plan/PresetRecipeRow.tsx`
- `client/components/home/__tests__/RecipeCarousel.flatlist-props.test.tsx`
- `client/constants/performance.ts`
- `docs/rules/performance.md`

## See Also

- [accessibilityViewIsModal does not suppress later siblings](accessibilityviewismodal-later-siblings-stay-accessible-2026-08-17.md) — another case where source reading said "reachable" and only a tree dump or device swipe told the truth
