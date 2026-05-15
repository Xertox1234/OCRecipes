---
title: "Rearchitect global RN/reanimated/expo-haptics mocks for spy-ability"
status: in-progress
priority: low
created: 2026-05-11
updated: 2026-05-11
assignee:
labels: [testing, deferred, audit-2026-05-11]
github_issue:
---

# Rearchitect global RN/reanimated/expo-haptics mocks for spy-ability

## Summary

`testing-patterns.md` memory states "Do NOT re-mock these inline — the global aliases handle it. If you need to assert calls, use `vi.spyOn` on the mock's exports." But 8 test files inline-mock anyway, and on inspection, none are cargo-cult — each provides functionality the global mocks can't:

- Mutable per-test return values (useTheme, useAccessibility, useHaptics, ThemeContext)
- Stateful behavior using React refs (useScrollLinkedHeader, useCollapsibleHeight need `useSharedValue` to persist across re-renders, but the global mock returns a fresh object each call)
- Missing exports (`AppState` in usePendingReminders, `Share` in useFavouriteRecipes)

## Background

Surfaced by audit 2026-05-11 (finding M2 in `docs/audits/2026-05-11-testing.md`) — initially classified as 9 violations of the documented "no inline RN mock" rule, but each was found to be necessary. The actual gap is in the global mock surface area, not the test files.

## Acceptance Criteria

- [ ] Update `test/mocks/react-native.ts` to expose commonly-overridden APIs as `vi.fn()`-based mocks so tests can `vi.spyOn(RN, 'useColorScheme').mockReturnValue(...)` without inline `vi.mock`:
  - [ ] `useColorScheme` → `vi.fn(() => "light")`
  - [ ] Add `AppState.addEventListener` as `vi.fn(() => ({ remove: vi.fn() }))`
  - [ ] Add `Share.share` as `vi.fn()`
  - [ ] Make `Alert.alert` a `vi.fn()`
- [ ] Update `test/mocks/react-native-reanimated.ts`:
  - [ ] `useReducedMotion` → `vi.fn(() => false)`
  - [ ] Consider providing a ref-backed `useSharedValue` mock (or document why simple-object is correct and `useScrollLinkedHeader`-style tests must inline-mock)
- [ ] Update `test/mocks/expo-haptics.ts` to expose `impactAsync`/`notificationAsync`/`selectionAsync` as `vi.fn()`s
- [ ] Migrate the 8 affected test files to use `vi.spyOn` on the global mocks instead of inline `vi.mock`:
  - `client/context/__tests__/ThemeContext.test.ts`
  - `client/hooks/__tests__/useTheme.test.ts`
  - `client/hooks/__tests__/usePendingReminders.test.ts`
  - `client/hooks/__tests__/useFavouriteRecipes.test.ts`
  - `client/hooks/__tests__/useScrollLinkedHeader.test.ts` _(may need to keep inline if ref-backed useSharedValue is rejected)_
  - `client/hooks/__tests__/useHaptics.test.ts`
  - `client/hooks/__tests__/useCollapsibleHeight.test.ts` _(same caveat as useScrollLinkedHeader)_
  - `client/hooks/__tests__/useAccessibility.test.ts`
- [ ] Update `docs/patterns/testing.md` and the testing-patterns memory file to document the spy-on pattern and clarify when inline mock is still acceptable (e.g., truly stateful behavior the global can't provide)

## Implementation Notes

- For `vi.spyOn` on a re-exported mock to work, the function must be a property of an imported namespace object, not destructured. Tests will use `import * as RN from "react-native"; vi.spyOn(RN, "useColorScheme").mockReturnValue("dark")`.
- Resetting spies: `vi.restoreAllMocks()` in `afterEach` undoes spy installation. `vi.clearAllMocks()` in `beforeEach` (currently in `test/setup.ts`) doesn't undo spies — only clears call history.
- The stateful `useSharedValue` mock pattern in `useScrollLinkedHeader.test.ts` may be the cleanest expression — consider documenting it as the canonical "stateful animation mock" pattern instead of trying to push it into the global mock.

## Dependencies

None.

## Risks

- Changing the global mock signature (plain function → `vi.fn()`) is technically a behavior change for any test that imports the alias. In practice, `vi.fn(() => x)` is callable identically to `() => x`, so risk is low. Run full suite to confirm.
- Spying requires test files to use `import * as` syntax or rely on the implementation detail of how vitest aliases export properties. May break with future Vitest versions.

## Related Audit Finding

- 2026-05-11 audit, finding M2: initially "delete inline mocks" → reclassified to false-positive on inline-mock side, true-positive on global-mock-architecture side.
