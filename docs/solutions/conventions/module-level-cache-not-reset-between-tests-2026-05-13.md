---
title: Module-level cache variable not reset between tests
track: knowledge
category: conventions
module: shared
tags: [testing, vitest, module-cache, state-leakage, lifecycle]
applies_to: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx']
created: '2026-05-13'
---

# Module-level cache variable not reset between tests

## Rule

When a module uses a module-level `let` variable as an in-memory cache, Vitest re-uses the same module instance across all tests in a file by default. State left by one test leaks into the next.

## Examples

```typescript
// discovery-storage.ts
let dismissedCache: Set<string> | null = null; // ← shared across tests!
```

**Fix:** Call the module's init/reset function in `beforeEach`. If the init function re-reads from storage (mocked as empty), it resets the internal variable to an empty state:

```typescript
beforeEach(async () => {
  (AsyncStorage.getItem as vi.Mock).mockResolvedValue(null);
  await initDiscoveryCache(); // resets dismissedCache → null → new Set()
});
```

**Alternative:** Use `vi.resetModules()` + dynamic `await import(...)` inside each test — but the `beforeEach` init pattern is simpler when the module already exports an init function.

## Why

Vitest's per-file module cache keeps module-level `let` bindings alive for the duration of the test file. A test that mutates the cache leaves the next test seeing the mutated state. Calling the module's reset/init function in `beforeEach` restores known state.

## Related Files

- `client/lib/__tests__/discovery-storage.test.ts`

## See Also

- [`vi.resetModules` + dynamic import for env-dependent module testing](../design-patterns/vi-resetmodules-for-env-dependent-testing-2026-05-13.md)
- [`setTimeout` in test fixtures vs. real async waits](settimeout-test-fixtures-vs-real-async-waits-2026-05-13.md)
