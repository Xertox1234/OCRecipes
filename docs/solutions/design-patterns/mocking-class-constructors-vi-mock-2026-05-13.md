---
title: 'Mocking class constructors in `vi.mock` — use a real class, not a factory'
track: knowledge
category: design-patterns
module: server
tags: [testing, vitest, mocks, classes, constructors]
applies_to: [server/**/__tests__/**/*.ts, client/**/__tests__/**/*.ts]
created: '2026-05-13'
---

# Mocking class constructors in `vi.mock` — use a real class, not a factory

## When this applies

When mocking a module that exports a class instantiated with `new` (e.g., `new SignedDataVerifier(...)`), use a real `class` in the mock factory — not `vi.fn().mockImplementation(() => ...)`. Arrow functions cannot be called with `new`, causing `TypeError: ... is not a constructor`.

## Why

Arrow functions are not constructable in JavaScript. `vi.fn()` returns an arrow function, so `new (vi.fn(() => instance))()` throws. A `class` declaration is always constructable and supports per-test method-level mocking when methods are assigned as instance properties.

## Examples

```typescript
// ✅ GOOD: Class mock — works with `new`
const mockMethod = vi.fn();

vi.mock("@apple/app-store-server-library", async () => {
  const actual = await vi.importActual<
    typeof import("@apple/app-store-server-library")
  >("@apple/app-store-server-library");
  return {
    ...actual,
    SignedDataVerifier: class MockSignedDataVerifier {
      verifyAndDecodeTransaction = mockMethod;
    },
  };
});
```

```typescript
// ❌ BAD: Arrow function — throws "is not a constructor"
vi.mock("@apple/app-store-server-library", async () => {
  const actual = await vi.importActual<...>("@apple/app-store-server-library");
  return {
    ...actual,
    SignedDataVerifier: vi.fn().mockImplementation(() => ({
      verifyAndDecodeTransaction: mockMethod,
    })),
  };
});
```

## Key elements

1. **Declare `mockMethod` outside** the `vi.mock()` factory so tests can configure it per test case
2. **Use `importActual`** and spread the real module to preserve non-mocked exports (enums, types, error classes)
3. **Assign mock methods as instance properties** (`= mockMethod`) inside the class body
4. **Reset the mock** in `beforeEach` with `mockMethod.mockReset()` to prevent state leakage
5. **Reset singletons** — if the production code caches the instance (lazy singleton), export a `resetX()` function and call it after `vi.resetModules()`

## When to use

- Mocking SDK clients instantiated with `new` (Apple `SignedDataVerifier`, AWS `S3Client`, Stripe `Stripe`, etc.)
- Any `vi.mock` where the mocked export is called as a constructor

## Exceptions

- Mocking plain functions or objects (use `vi.fn()` directly)
- Mocking modules where you don't need `new` (use `vi.fn().mockReturnValue()`)

## Related Files

- `server/services/__tests__/receipt-validation.test.ts` — `MockSignedDataVerifier` class mock with `mockVerifyAndDecodeTransaction`

## See Also

- [Mocking constructable web APIs (XMLHttpRequest) in Vitest](mocking-constructable-web-apis-xhr-vitest-2026-05-13.md)
- [Controllable mock via `vi.hoisted`](controllable-mock-via-vi-hoisted-2026-05-13.md)
