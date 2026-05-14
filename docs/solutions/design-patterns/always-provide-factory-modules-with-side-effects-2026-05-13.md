---
title: "Always provide a factory for `vi.mock` on modules with side effects"
track: knowledge
category: design-patterns
tags: [testing, vitest, mocks, hoisting, side-effects]
module: server
applies_to: ["server/**/__tests__/**/*.ts"]
created: 2026-05-13
---

# Always provide a factory for `vi.mock` on modules with side effects

## When this applies

`vi.mock("module")` without a factory still loads the real module to discover its exports and auto-mock them. If the module has eager side effects (e.g., `db.ts` throws when `DATABASE_URL` is missing), the auto-mock will fail.

## Why

The factory short-circuits the auto-mock — Vitest uses the factory output instead of loading the real module to introspect exports. Module-level side effects (DB connection, env-var validation, network calls) never run.

## Examples

```typescript
// ❌ BAD — auto-mock loads the module, DATABASE_URL check fires
vi.mock("../../storage");

// ✅ GOOD — factory prevents the real module from loading
vi.mock("../../storage", () => ({ storage: {} }));

// ✅ GOOD — factory with meaningful stubs
vi.mock("../../storage", () => ({
  storage: {
    getUser: vi.fn(),
    createItem: vi.fn(),
  },
}));
```

## When to use

Mocking any module that imports `../db`, `../lib/openai`, or any other module with top-level side effects.

## Gotcha — `vi.mock` hoisting

Variables defined outside the factory aren't available inside it because `vi.mock` is hoisted to the top of the file. Define classes/values inside the factory:

```typescript
// ❌ BAD — class isn't initialized when hoisted factory runs
class MockError extends Error { ... }
vi.mock("../../storage", () => ({ MyError: MockError }));

// ✅ GOOD — define inside the factory
vi.mock("../../storage", () => {
  class MockError extends Error { ... }
  return { MyError: MockError };
});
```

## Gotcha — `vi.hoisted()` for mock handle variables

When a test needs a handle on a mock function defined alongside a `vi.mock()` factory, the standard `const mockFn = vi.fn()` pattern breaks if the mocked module is imported statically:

```typescript
// ❌ BREAKS when the production module uses a static import of "../../storage"
const mockUpdate = vi.fn().mockResolvedValue(undefined);
vi.mock("../../storage/index", () => ({
  storage: { updateCommunityRecipeImageUrl: mockUpdate }, // ReferenceError!
}));

// ✅ CORRECT — vi.hoisted() runs before the mock factory
const mockUpdate = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("../../storage/index", () => ({
  storage: { updateCommunityRecipeImageUrl: mockUpdate },
}));
```

This problem surfaces specifically when converting a `dynamic import()` call to a
static `import` — the dynamic form deferred evaluation until runtime (after mocks
were set up), while the static form evaluates at module load time before the
`const mockUpdate` line runs.

**Rule of thumb:** If you see `ReferenceError: Cannot access 'mockX' before initialization` in a test that uses `vi.mock()`, the mock variable needs `vi.hoisted()`.

## Related Files

- `server/routes/__tests__/batch-scan.test.ts` — `BatchStorageError` defined inside factory
- `server/routes/__tests__/_helpers.test.ts` — storage mock with factory to avoid db.ts
- `server/services/__tests__/recipe-generation.test.ts` — `mockUpdateCommunityRecipeImageUrl` uses `vi.hoisted()` after `recipe-generation.ts` was changed from dynamic `await import("../storage/index")` to a static import

**Origin:** Coach Pro test failures (2026-04-10) — 4 test files failed because auto-mock triggered `DATABASE_URL` check; 2026-04-28 audit L12 — converting dynamic import to static broke the test.

## See Also

- [Controllable mock via `vi.hoisted`](controllable-mock-via-vi-hoisted-2026-05-13.md)
- [Facade mock alignment for re-exported values](../conventions/facade-mock-alignment-re-exported-values-2026-05-13.md)
