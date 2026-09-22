---
title: When inline `vi.mock` of globally-aliased modules IS correct
track: knowledge
category: conventions
module: client
tags: [testing, vitest, react-native, mocks, alias, audit-triage]
applies_to: [client/**/__tests__/**/*.test.ts, client/**/__tests__/**/*.test.tsx]
created: '2026-05-13'
last_updated: '2026-09-21'
---

# When inline `vi.mock` of globally-aliased modules IS correct

## Rule

The general guidance ("do NOT inline-mock `react-native` / `react-native-reanimated` / `expo-haptics` — the global aliases handle it") is correct for the _common_ case: a test that renders a component and doesn't care about the mock's return values. But there are legitimate reasons to inline-mock even an already-aliased module — don't blanket-prohibit.

## Inline `vi.mock` IS correct when the test needs

1. **Mutable per-test return values** — The global alias exposes `useColorScheme: () => "light"` (a plain function, not `vi.fn()`). To toggle the value per test, you either need to inline-mock with `importOriginal()` + spread + override, or update the global mock to use `vi.fn()` for spy-ability. Until the latter ships, inline mock is the only path.

   ```typescript
   const mockUseColorScheme = vi.fn();
   vi.mock("react-native", async (importOriginal) => {
     const actual = await importOriginal<typeof import("react-native")>();
     return { ...actual, useColorScheme: () => mockUseColorScheme() };
   });
   ```

2. **Stateful behavior the simple alias can't provide** — Tests of hooks like `useScrollLinkedHeader` or `useCollapsibleHeight` need `useSharedValue` to persist across re-renders (backed by `useRef`). The global alias returns a fresh `{value: init}` each call, which mutates fine but doesn't persist. The inline mock provides the ref-backed version.

3. **Missing exports** — The global mock covers commonly-rendered APIs but not every RN export. `AppState`, `Share`, and certain platform APIs may not be in the global alias. Inline mock fills the gap.

   **Worked example — `test/mocks/react-native-reanimated.ts`'s `Animated` namespace only exports `View`/`Text`/`createAnimatedComponent`.** `Animated.ScrollView`, `measure`, and `scrollTo` are absent. Rendering any screen that uses `<Animated.ScrollView>` directly (not via `createAnimatedComponent`) crashes with a misleading React error — `Element type is invalid: expected a string ... but got: undefined. You likely forgot to export your component from the file it's defined in` — that points at the SCREEN's own exports, not the mock's. `measure`/`scrollTo` being `undefined` only bites if a test actually drives the interaction path that calls them (e.g. a gesture handler invoking `runOnUI`); merely importing them from the mock is harmless. Fix locally in the affected test file, without touching the shared mock:

   ```typescript
   vi.mock("react-native-reanimated", async () => {
     const actual =
       await vi.importActual<typeof import("react-native-reanimated")>(
         "react-native-reanimated",
       );
     return {
       ...actual,
       default: { ...actual.default, ScrollView: actual.default.View },
     };
   });
   ```

   Confirmed affected: `client/screens/HomeScreen.tsx` and `client/screens/ProfileScreen.tsx` both render `<Animated.ScrollView>` directly (`grep -rln "Animated\.ScrollView" client --include="*.tsx" | grep -v __tests__`); as of 2026-09-20 `HomeScreen.tsx` has a test file using this override, `ProfileScreen.tsx` still has none and will hit the same crash the first time it does. The durable fix (adding `ScrollView`/`measure`/`scrollTo` to the shared mock) is out of scope for a single-todo test-only PR — this per-file override is the correct interim shape until then.

4. **Gotcha — two specifiers aliased to the same mock file share ONE registry entry.** `vi.mock(specifier, factory)` is keyed by the **resolved module ID**, not the specifier string (same mechanism as [`vi.mock` path must resolve to the same module ID as the production import](vi-mock-path-must-match-production-import-id-2026-06-01.md), but here the collision runs the *other* direction: two different specifiers, not two different resolutions of one specifier). If `vitest.config.ts`'s `resolve.alias` maps two different package names to the identical physical file — e.g. both `"react-native-reanimated"` and `"react-native-worklets"` pointing at `test/mocks/react-native-reanimated.ts`, added 2026-09-21 so `react-native-worklets`' `scheduleOnUI`/`scheduleOnRN` (the replacement for `react-native-reanimated`'s deprecated `runOnUI`/`runOnJS`) resolve to a mock instead of the real native package — then a test file's own inline `vi.mock("react-native-reanimated", factory)` also intercepts every OTHER file's `import ... from "react-native-worklets"` that resolves to the same physical path, once Vitest builds the module graph. If that inline factory omits an export the *other* specifier's consumer needs, the failure surfaces as `[vitest] No "<name>" export is defined on the "<other-specifier>" mock` — naming the specifier you didn't touch, not the one whose factory is incomplete. Confirmed 2026-09-21: `client/hooks/__tests__/useScrollLinkedHeader.test.ts`'s local `vi.mock("react-native-reanimated", ...)` (needed for the ref-backed `useSharedValue`/`useAnimatedStyle` shapes per item 2 above) didn't export `scheduleOnRN`; `client/hooks/useScrollLinkedHeader.ts` imports `scheduleOnRN` from `"react-native-worklets"`, which resolves to the same aliased file — masked only because none of that test file's cases scrolled past the threshold that reaches the `scheduleOnRN` call. **Any time a new specifier is aliased to an existing shared mock file, grep for every local `vi.mock` of the file it now shares a resolved ID with, and add the new export there too** — the shared global mock file itself is the only place this can't silently drift, since it has no competing local override.

## Inline mock is NOT correct when

- The test just wants the global behavior (`useColorScheme` returns "light", `Platform.OS` is "ios"). Use the global alias; don't redeclare.
- The test wants to _assert that a function was called_. Use `vi.spyOn(globalMockNamespace, "fnName")` instead of replacing the whole module — but this requires the global mock to expose the function as a `vi.fn()`, not a plain function.

## Audit triage rule

Before flagging an inline mock of a globally-aliased module as a violation, ask: does the test need mutable values, statefulness, or missing exports? If yes, the inline mock is legitimate; the real fix (if any) is to make the global mock spy-able, not to delete the inline mock.

**Origin:** Audit 2026-05-11 finding M2 (initially "9 violations" → reclassified after inspection: 0 cargo-cult, 9 legitimate uses of inline mock for behaviors the global aliases can't provide).

## See Also

- [Vitest alias mocks for native-only React Native libraries](../design-patterns/vitest-alias-mocks-native-libraries-2026-05-13.md)
- [`setTimeout` in test fixtures vs. real async waits](settimeout-test-fixtures-vs-real-async-waits-2026-05-13.md)
