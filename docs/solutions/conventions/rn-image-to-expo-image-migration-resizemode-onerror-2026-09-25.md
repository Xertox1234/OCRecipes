---
title: "Migrating an RN Image consumer to expo-image: don't fight resizeMode, retype onError"
track: knowledge
category: conventions
tags: [react-native, expo-image, images, migration, testing]
module: client
applies_to: [client/**/*.tsx, test/mocks/*.ts]
created: '2026-09-25'
---

# Migrating an RN Image consumer to expo-image: don't fight resizeMode, retype onError

## Rule

When swapping a component's `Image` import from `"react-native"` to `"expo-image"`:

1. **Do not hardcode `contentFit` upstream of a `{...rest}`/`{...imageProps}` spread** if any existing caller still passes RN's `resizeMode` prop. expo-image's own `resolveContentFit()` (`node_modules/expo-image/src/utils.ts`) already maps the deprecated `resizeMode` values (`cover`/`contain`/etc.) to `contentFit` **when `contentFit` is unset**, and defaults to `'cover'` when neither prop is set — the same default RN's `Image` used. Setting your own `contentFit` on the component's own fixed props means it always wins over a caller's `resizeMode`, silently overriding portrait/"contain" callers that relied on the old default-cover-except-when-I-say-so behavior. Leave `contentFit` unset and let the compat layer do the mapping; only set it explicitly if the component has no `resizeMode`-passing callers to begin with.
2. **Retype (not just re-import) any shared `onError` handler.** expo-image's `onError` callback shape is `(event: ImageErrorEventData) => void` where `ImageErrorEventData = { error: string }` — a plain object, never RN's `NativeSyntheticEvent<ImageErrorEventData>` wrapper. A handler still typed for RN's wrapper does NOT compile: `ImageProps.onError` is declared with property syntax, so under this repo's `strict` (`strictFunctionTypes`) the parameter check is contravariant and fails with `TS2322 … 'ImageErrorEventData' is missing … nativeEvent, currentTarget, target …` whether or not the body reads the event (measured with `tsc --strict` against the installed types). At runtime the old access would still work: `ExpoImage.tsx`'s `withDeprecatedNativeEvent` defines a self-referential `nativeEvent` getter, so `event.nativeEvent.error` resolves with a deprecation `console.warn`. So the compiler forces the retype; don't silence it with a cast, retype to `ImageErrorEventData` from `expo-image`.

## When this applies

Any migration of a component from RN's built-in `Image` to `expo-image`'s `Image`, especially a shared/wrapped component (like `FallbackImage`) with several call sites that may already pass RN-Image-only props.

## Why

The two libraries share enough surface area (`source`, `style`, `resizeMode`, `blurRadius`, `defaultSource`, `onLoad`, `accessibilityLabel`, `alt`, `accessibilityIgnoresInvertColors` — the last inherited transitively via expo-image's `ImageProps extends Omit<ViewProps, 'style'|'children'>`) that a migration can look like a drop-in import swap, which hides the two real incompatibilities above. Sweep every call site (`grep -rn "<Component" client --include="*.tsx"`) for `resizeMode`, `onError`, `onLoad*`, `defaultSource`, and `blurRadius` **before** deciding whether to add an explicit `contentFit`/retype anything — do this before writing the migration, not after a reviewer catches it.

## Examples

```tsx
// GOOD — FallbackImage.tsx: no explicit contentFit; callers with
// resizeMode="contain" (nutrition-label photos) keep working through the
// compat layer, callers with nothing get expo-image's own cover default.
<Image
  source={{ uri: validSource.uri }}
  style={style}
  cachePolicy="memory-disk"
  accessible={false}
  importantForAccessibility="no"
  onError={handleError}
  {...imageProps} // may carry resizeMode="contain" from the caller
/>
```

```tsx
// BAD — hardcodes contentFit before the spread; a caller passing
// resizeMode="contain" is silently overridden to "cover".
<Image
  source={{ uri: validSource.uri }}
  contentFit="cover"
  {...imageProps} // resizeMode="contain" here is now dead
/>
```

```ts
// GOOD — handler retyped to expo-image's real shape.
import { type ImageErrorEventData } from "expo-image";
const handleError = useCallback((event: ImageErrorEventData) => {
  setHasError(true);
  onError?.(event);
}, [onError]);
```

```ts
// BAD — still typed for RN's wrapper after the import swap. Fails to compile
// under strictFunctionTypes (TS2322); an `as any` to force it through would
// "work" only via expo-image's deprecated nativeEvent getter (console.warn).
import { type ImageErrorEventData, type NativeSyntheticEvent } from "react-native";
const handleError = (event: NativeSyntheticEvent<ImageErrorEventData>) => { ... };
```

Testing: a jsdom mock for `expo-image` (`test/mocks/expo-image.ts`, aliased once in `vitest.config.mts`'s `resolve.alias`) should mirror the existing RN `Image` mock's DOM-attribute mapping (`src` from `source.uri`, `data-testid` from `testID`, `aria-label`/`alt` from `accessibilityLabel`) and additionally surface `cachePolicy`/`contentFit` as `data-*` attributes so a migration test can assert they actually reached the element, and invoke `onError` with the real `{ error: string }` shape rather than a wrapped event. A pre-existing per-test `vi.mock("expo-image", ...)` for the same specifier (e.g. `CookbookCreateScreen.test.tsx`) keeps working unaffected by the new global alias — `vi.mock` wins for its own test file regardless of what the alias resolves to, as long as both target the *same* specifier string (this is not the cross-specifier alias collision covered by [inline-vi-mock-globally-aliased-modules-2026-05-13.md](inline-vi-mock-globally-aliased-modules-2026-05-13.md) item 4, which is about two *different* specifiers resolving to one physical file).

## Exceptions

A component with no existing `resizeMode`-passing callers (a brand-new usage, or one you're free to update all call sites of in the same PR) can set `contentFit` explicitly with no risk — there's nothing for it to override.

## Related Files

- `client/components/FallbackImage.tsx` — the migrated component
- `client/camera/components/ProductChip.tsx` — a second, simpler migrated consumer (no passthrough props, so no resizeMode/onError risk)
- `test/mocks/expo-image.ts` — the jsdom mock
- `vitest.config.mts` — `resolve.alias` registration

## See Also

- [FallbackImage for remote image loading with themed placeholder](../design-patterns/fallback-image-remote-image-loading-2026-05-13.md)
- [inline-vi-mock-globally-aliased-modules-2026-05-13.md](inline-vi-mock-globally-aliased-modules-2026-05-13.md)
