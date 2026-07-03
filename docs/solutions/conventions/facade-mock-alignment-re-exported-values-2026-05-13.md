---
title: Facade mock alignment for re-exported values (constants and classes)
track: knowledge
category: conventions
module: server
tags: [testing, vitest, mocks, facade, storage, re-export]
applies_to: [server/**/__tests__/**/*.ts]
created: '2026-05-13'
---

# Facade mock alignment for re-exported values (constants and classes)

## Rule

When `vi.mock("../../storage")` intercepts the storage facade, the mock replaces the **entire module** — including any re-exported values like types, classes, and constants. If a route imports a re-exported value (e.g., `import { storage, MAX_IMAGE_SIZE_BYTES } from "../storage"`), the mock must include it or the route receives `undefined` and throws at runtime.

## Examples

```typescript
// ❌ BAD: Mock only returns `storage` — re-exported constants are undefined
vi.mock("../../storage", () => ({
  storage: {
    getUser: vi.fn(),
    createScannedItem: vi.fn(),
  },
}));
// Route does: import { storage, MAX_IMAGE_SIZE_BYTES } from "../storage"
// MAX_IMAGE_SIZE_BYTES is undefined → route throws → test gets 500

// ✅ GOOD: Mock includes re-exported values from sub-modules
vi.mock("../../storage", async () => {
  const sessions = await import("../../storage/sessions");
  return {
    MAX_IMAGE_SIZE_BYTES: sessions.MAX_IMAGE_SIZE_BYTES,
    storage: {
      getUser: vi.fn(),
      createScannedItem: vi.fn(),
    },
  };
});
```

For re-exported classes used in `instanceof` checks (like `BatchStorageError`), the mock must return the real class — otherwise `catch` blocks that check `error instanceof BatchStorageError` won't match:

```typescript
vi.mock("../../storage", async () => {
  const batch = await import("../../storage/batch");
  return {
    BatchStorageError: batch.BatchStorageError,
    storage: {
      /* ... */
    },
  };
});
```

## When to update mocks

- When adding a new re-export to `server/storage/index.ts`
- When changing a route from a direct sub-module import to a facade import
- When a test gets unexpected 500s after a refactor that didn't change business logic

## Symptoms of misalignment

- Tests expect 200/400/404 but get 500
- Error messages like `Cannot read properties of undefined` in test output
- Tests pass in isolation but fail when run with the full suite (mock hoisting order)

## Related Files

- `server/routes/__tests__/photos.test.ts` — `MAX_IMAGE_SIZE_BYTES` re-exported from sessions
- `server/routes/__tests__/batch-scan.test.ts` — `BatchStorageError` re-exported from batch
- `server/routes/__tests__/cooking.test.ts` — `cookingSessionStore` re-exported with real implementation

## See Also

- [Always provide a factory for modules with side effects](../design-patterns/always-provide-factory-modules-with-side-effects-2026-05-13.md)
