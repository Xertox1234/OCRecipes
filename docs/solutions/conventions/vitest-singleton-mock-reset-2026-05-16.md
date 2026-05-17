---
title: Singletons from test/mocks/ must be reset per-test with .mockReset()
track: knowledge
category: conventions
tags:
  - vitest
  - testing
  - mocks
module: client
applies_to:
  - test/setup.ts
  - test/mocks/**/*.ts
created: 2026-05-16
---

## Rule

Every mock singleton exported from a `test/mocks/*.ts` file (e.g., `expo-haptics.ts`, `react-native-reanimated.ts`) must be reset **by name** using `.mockReset()` inside the global `beforeEach` in `test/setup.ts`. This ensures that any `mockImplementation`, `mockReturnValue`, or `mockResolvedValueOnce` overrides applied in one test do not leak to subsequent tests in the same worker file.

Do **not** rely on `vi.clearAllMocks()` alone (it clears call history only) and **do not** enable the `mockReset: true` global option in `vitest.config.ts` (it breaks `vi.mock()` factory defaults).

## Why

The `test/mocks/` modules export singletons created with `vi.fn(/* optional default impl */)`. These singletons are imported once per worker file (due to module caching). A test that calls `.mockImplementation()` or `.mockReturnValue()` mutates the singleton’s behavior for the entire worker file unless it is properly reset.

- `vi.clearAllMocks()` only clears the call history (`mock.calls`, `mock.instances`, `mock.results`) – it does **not** undo `mockImplementation` or return-value overrides.
- `vi.restoreAllMocks()` restores the original implementation of `vi.fn()` (but not `vi.spyOn`-style mocks).
- `mockReset()` restores the function to its initial state, including the constructor-argument default (the `impl` passed to `vi.fn(impl)`). This is exactly what we need.

Using the Vitest-recommended global `mockReset: true` in `vitest.config.ts` sounds appealing but is **dangerous**: it also resets the defaults defined inside `vi.mock()` factory bodies (e.g., `vi.fn().mockResolvedValue(...)`), which have **no constructor-arg default**. This inadvertently broke 72 tests across 21 files in this repo. Therefore we scope the reset to our named singletons only.

Per-file `restoreAllMocks()` in `afterEach` is still required for tests using `vi.spyOn()` because `mockReset` does not uninstall a spy.

## Examples

### ✅ Correct: `test/setup.ts`

```ts
import {
  impactAsync,
  notificationAsync,
  selectionAsync,
} from "./mocks/expo-haptics";
import { useReducedMotion } from "./mocks/react-native-reanimated";

// Reset only the test/mocks/ vi.fn() singletons per test. Add a line here
// whenever a new vi.fn() singleton is added to a test/mocks/ file.
beforeEach(() => {
  vi.clearAllMocks();
  impactAsync.mockReset();
  notificationAsync.mockReset();
  selectionAsync.mockReset();
  useReducedMotion.mockReset();
});
```

Per-file `restoreAllMocks()` in `afterEach` stays in the individual test
files that use `vi.spyOn()` (e.g. `useHaptics.test.ts`,
`useAccessibility.test.ts`) — it un-installs the spy, which `.mockReset()`
does not do.

### ❌ Wrong: relying on `clearAllMocks` only

```ts
beforeEach(() => {
  vi.clearAllMocks(); // Call history cleared, but mock implementations survive
});
```

### ❌ Wrong: enabling `mockReset: true` in `vitest.config.ts`

```ts
export default defineConfig({
  test: {
    mockReset: true, // Resets vi.mock() factory defaults -> 72 failing tests
  },
});
```

## Related Files

- `test/setup.ts`
- `test/mocks/expo-haptics.ts`
- `test/mocks/react-native-reanimated.ts`
- `vitest.config.ts`

## See Also

- `docs/rules/testing.md`
