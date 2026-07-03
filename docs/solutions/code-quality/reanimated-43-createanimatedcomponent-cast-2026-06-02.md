---
title: Reanimated 4.3 createAnimatedComponent requires cast-through-unknown
track: bug
category: code-quality
module: client
severity: low
tags: [reanimated, typescript, animated, flatlist, cast, react-native]
symptoms: ['TS2352: Conversion of type ''AnimatedComponentType<...>'' to type ''typeof FlatList'' may be a mistake because neither type sufficiently overlaps', Appears only after bumping react-native-reanimated to 4.3+ on an existing `Animated.createAnimatedComponent(X) as typeof X` line, 'check:types fails (exit 2) with zero runtime/behavior change']
applies_to: [client/**/*.tsx]
created: '2026-06-02'
---

# Reanimated 4.3 createAnimatedComponent requires cast-through-unknown

## Problem

`Animated.createAnimatedComponent(FlatList) as typeof FlatList` — a common pattern for typing an animated component as its base component — stops type-checking after upgrading `react-native-reanimated` to 4.3+. `tsc` errors with TS2352 ("neither type sufficiently overlaps").

## Symptoms

- `TS2352: Conversion of type 'AnimatedComponentType<Readonly<FlatListProps<unknown>>, FlatList<unknown>>' to type 'typeof FlatList' may be a mistake...`
- Surfaces immediately on a Reanimated 4.1→4.3 bump; no change to the component code itself.
- `npm run check:types` exits 2.

## Root Cause

Reanimated 4.3 tightened the return type of `createAnimatedComponent` (`AnimatedComponentType<...>`) so it no longer structurally overlaps with `typeof <Component>`. A direct `as` between two non-overlapping types is a TS2352 error; the compiler's own hint is to "convert the expression to 'unknown' first."

## Solution

Cast through `unknown`. The resulting type stays `typeof <Component>` for all downstream usage — only the assertion form changes, so call sites are unaffected:

```ts
const AnimatedFlatList = Animated.createAnimatedComponent(
  FlatList,
) as unknown as typeof FlatList;
```

Reanimated 4.3+ also deprecates `createAnimatedComponent` in favor of `Animated.FlatList` etc., but switching is a larger, optional change — the cast is the minimal fix. No `deprecation`/`no-deprecated` ESLint rule is enabled in this repo and `tsc` does not fail on deprecation warnings, so the cast passes CI.

## Prevention

- When wrapping any RN component with `Animated.createAnimatedComponent(X)` and re-typing it as `typeof X`, write `as unknown as typeof X`.
- Run `check:types` locally after any Reanimated version bump — this typing regression is invisible to the native build (which skips JS) and only shows up in `tsc`/CI.

## Related Files

- `client/screens/meal-plan/RecipeBrowserScreen.tsx` — the `AnimatedFlatList` declaration

## See Also

- [Upgrading to VisionCamera 5 + building for iOS on Xcode 26](../best-practices/visioncamera-5-upgrade-ios-xcode26-build-2026-06-02.md) — the upgrade that bumped Reanimated to 4.3 and required this cast
