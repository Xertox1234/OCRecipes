---
title: Controllable mock via vi.hoisted for per-test overrides
track: knowledge
category: design-patterns
module: server
tags: [testing, vitest, mocking, vi-hoisted, multer]
applies_to: [server/**/__tests__/**/*.ts]
created: '2026-05-13'
---

# Controllable mock via vi.hoisted for per-test overrides

## When this applies

Use `vi.hoisted` to create a mutable reference that a `vi.mock` factory can read, enabling per-test overrides without redefining the mock per test.

## Examples

```typescript
const { mockFileBuffer } = vi.hoisted(() => ({
  mockFileBuffer: { current: Buffer.from("fake-image") },
}));

vi.mock("multer", () => {
  const multerMock = () => ({
    single: () => (req, _res, next) => {
      req.file = { buffer: mockFileBuffer.current } as Express.Multer.File;
      next();
    },
  });
  multerMock.memoryStorage = () => ({});
  return { default: multerMock };
});

// In a specific test:
it("rejects oversized images", async () => {
  const original = mockFileBuffer.current;
  mockFileBuffer.current = Buffer.alloc(6 * 1024 * 1024);
  try {
    // ... test logic
  } finally {
    mockFileBuffer.current = original;
  }
});
```

## Why

`vi.mock` factories are hoisted and run once, so they can't reference test-local variables. Wrapping the value in a `{ current }` ref object via `vi.hoisted` gives tests a stable reference they can mutate per-test while the mock reads the latest value.

## Related Files

- `server/routes/__tests__/` — usage in multer-based upload tests
