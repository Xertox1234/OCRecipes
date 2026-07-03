---
title: When inline `vi.mock` of globally-aliased modules IS correct
track: knowledge
category: conventions
module: client
tags: [testing, vitest, react-native, mocks, alias, audit-triage]
applies_to: [client/**/__tests__/**/*.test.ts, client/**/__tests__/**/*.test.tsx]
created: '2026-05-13'
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

## Inline mock is NOT correct when

- The test just wants the global behavior (`useColorScheme` returns "light", `Platform.OS` is "ios"). Use the global alias; don't redeclare.
- The test wants to _assert that a function was called_. Use `vi.spyOn(globalMockNamespace, "fnName")` instead of replacing the whole module — but this requires the global mock to expose the function as a `vi.fn()`, not a plain function.

## Audit triage rule

Before flagging an inline mock of a globally-aliased module as a violation, ask: does the test need mutable values, statefulness, or missing exports? If yes, the inline mock is legitimate; the real fix (if any) is to make the global mock spy-able, not to delete the inline mock.

**Origin:** Audit 2026-05-11 finding M2 (initially "9 violations" → reclassified after inspection: 0 cargo-cult, 9 legitimate uses of inline mock for behaviors the global aliases can't provide).

## See Also

- [Vitest alias mocks for native-only React Native libraries](../design-patterns/vitest-alias-mocks-native-libraries-2026-05-13.md)
- [`setTimeout` in test fixtures vs. real async waits](settimeout-test-fixtures-vs-real-async-waits-2026-05-13.md)
