---
title: "A Vitest beforeEach whose arrow body RETURNS a function (e.g. `beforeEach(() => mock.mockReset())`) registers that function as an after-each teardown — the mock is then called outside any test and throws"
track: bug
category: logic-errors
module: client
severity: low
tags: [testing, vitest, mocks, hooks]
symptoms: [An error is thrown after a test finishes rather than inside it, A mock implementation runs with no arguments after each test, 'Test passes but the run reports an unhandled error from a mock (e.g. "canceled")']
applies_to: ["**/__tests__/**/*.ts", "**/__tests__/**/*.tsx"]
created: 2026-10-05
---

# A function returned from `beforeEach` runs as teardown

## Problem

`beforeEach(() => mockGetProviderToken.mockReset())` — a concise arrow body returns
`mockReset()`'s result, which is the mock function itself. Vitest treats a function
returned from `beforeEach` as a cleanup callback and calls it after each test. The
mock (with whatever implementation the test left on it) then runs outside any
`expect`, and an implementation that throws or rejects surfaces as an error after
the test (seen as a stray "canceled" rejection in `useAuth.test.ts`, Sign in with Apple
Task 15).

## Fix

Use a block body so nothing is returned:

```ts
beforeEach(() => {
  mockGetProviderToken.mockReset();
});
```

## Why it is easy to miss

`mockReset()`, `mockClear()`, `mockResolvedValue()` and friends all return the mock
for chaining, so every one-liner of this shape returns a function. Jest ignores the
return value; Vitest does not.
