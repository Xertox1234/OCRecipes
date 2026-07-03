---
title: 'Vitest 4: mocking a class you `new` requires a real class, not vi.fn() with an arrow impl'
track: bug
category: runtime-errors
module: server
severity: low
tags: [vitest, mocking, testing, constructor, esm]
symptoms: ['Test throws `TypeError: () => ({ ... }) is not a constructor`.', 'Production code does `new SomeSdk(key)` and the mock is `vi.fn().mockImplementation(() => ({ ... }))`.']
applies_to: ['**/__tests__/**/*.test.ts']
created: '2026-06-19'
---

# Vitest 4: mocking a class you `new` requires a real class, not vi.fn() with an arrow impl

## Problem

Under Vitest 4, calling `new` on a `vi.fn()` whose implementation is an **arrow
function** throws `TypeError: ... is not a constructor`. Arrow functions have no
`[[Construct]]` internal method, and Vitest 4 honors that strictly (older
Jest-era semantics silently tolerated it).

## Symptoms

- `TypeError: () => ({ emails: { send: mockSend } }) is not a constructor`
- The failing line is the production `new Resend(key)` (or any `new SomeSdk()`),
  reached only by the tests that actually construct the dependency — the
  no-op/guard tests that never hit `new` still pass, which masks the cause.

## Root Cause

The mock factory returned the SDK as an arrow-implemented spy:

```ts
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({ emails: { send: mockSend } })), // ✗ not newable
}));
```

`new Resend(key)` then invokes the arrow as a constructor → throw.

## Solution

Mock the constructable dependency with a real **class** (or a `function`), and
move assertions to the inner spy:

```ts
const mockSend = vi.fn().mockResolvedValue({ data: { id: "mock" }, error: null });
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: mockSend };
  },
}));
// assert on mockSend, not on the constructor
expect(mockSend).toHaveBeenCalledTimes(1);
```

Note: the inner spy must be **`mock`-prefixed** (`mockSend`) — `vi.mock` factories
are hoisted above local `const` declarations, and Vitest only exempts variables
whose name starts with `mock` from that hoisting guard. The class field
`emails = { send: mockSend }` is evaluated at instantiation, so it captures the
real spy by then.

## Prevention

When the code under test does `new X(...)`, mock `X` with a `class`/`function`
shape, never an arrow-implemented `vi.fn()`. If you need to assert the
constructor was called, use a `function` mock (`vi.fn(function () { ... })`) or
put the spy on the prototype.

## Related Files

- `server/services/__tests__/email.test.ts` — the Resend class mock
- `server/services/email.ts` — `new Resend(key)`

## See Also

- [pre-commit skips type-aware eslint run it before push](../conventions/pre-commit-skips-type-aware-eslint-run-it-before-push-2026-06-19.md) — another local-vs-CI test/lint gotcha from the same feature
