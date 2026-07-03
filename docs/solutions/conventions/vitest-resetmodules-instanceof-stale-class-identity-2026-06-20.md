---
title: vi.resetModules() + a top-level class import breaks instanceof in the module under test
track: knowledge
category: conventions
module: client
tags: [testing, vitest, resetModules, instanceof, module-cache]
applies_to: [client/**/__tests__/**/*.ts]
created: '2026-06-20'
---

## Rule

In a test file that calls `vi.resetModules()` in `beforeEach`, when the
module under test does an `error instanceof SomeClass` check, any
`SomeClass` instance the test constructs to feed that check MUST come from a
**dynamically-imported** class (`const { SomeClass } = await import("@/lib/some-class")`)
**inside the test body** — never from a top-level static
`import { SomeClass } from "@/lib/some-class"`.

## Smell patterns

- An `instanceof`-gated branch that passes in production but silently takes
  the wrong path **only** in a `vi.resetModules()` test.
- A field read after the narrowing (e.g. `error.status`) comes back
  `undefined`, so the test asserts the wrong branch fired (an error listener
  called when it should not be, an item evicted that should have synced).
- A static `import { SomeClass }` at the top of a file whose every other
  dependency is imported dynamically inside the test body.

## Why

A top-level static import binds to the module generation loaded at
file-parse time. `vi.resetModules()` then evicts the module cache, so the
subsequent `await import(<module under test>)` pulls a **fresh** generation
— including a fresh, distinct copy of `SomeClass`'s class object. The module
under test's `instanceof SomeClass` now compares against that fresh class,
while the test's instance was built from the **stale** class. Two different
class identities → `instanceof` returns `false` → the narrowing fails and
any field read off the instance resolves to `undefined`.

In production there is a single module instance, so `instanceof` is exact
and correct — the failure is purely a test artifact of `resetModules`. Fix
it in the test, not by loosening the production `instanceof` into a
structural property read (that would trip the type-guard-over-cast rule and
loosely match unrelated errors with a stray field of the same name).

## Examples

Wrong — stale class identity, `instanceof` silently false:

```ts
import { ApiError } from "@/lib/api-error"; // bound at parse time

beforeEach(() => {
  vi.resetModules();
});

it("treats a 404 on a replayed DELETE as idempotent success", async () => {
  const { drainQueue } = await import("../offline-queue-drain");
  // This ApiError is the STALE class; the freshly-imported drain checks
  // against a DIFFERENT ApiError → instanceof is false → status undefined.
  vi.mocked(apiRequest).mockRejectedValue(
    new ApiError("404: Not Found", undefined, 404),
  );
  await drainQueue();
  // FAILS: the DELETE-404 idempotent branch never fires.
});
```

Correct — import the class dynamically, after `resetModules` has run:

```ts
it("treats a 404 on a replayed DELETE as idempotent success", async () => {
  const { drainQueue } = await import("../offline-queue-drain");
  // Same generation as the drain → instanceof holds, status is read.
  const { ApiError } = await import("@/lib/api-error");
  vi.mocked(apiRequest).mockRejectedValue(
    new ApiError("404: Not Found", undefined, 404),
  );
  await drainQueue();
});
```

Order within the test body does not matter once `resetModules` has run — the
drain and the class share the same generation either way.

## Exceptions

This is distinct from the env-dependent-module case
(`vi-resetmodules-for-env-dependent-testing`), where the stale thing is a
top-level `process.env` constant baked into the module. Here the stale thing
is a **class identity** used for `instanceof`; the test is still correct in
its intent, only its class reference is from the wrong generation.

If the test does not construct the class itself (it only triggers the module
under test, which constructs and throws its own instances), there is no
identity mismatch — both come from the same fresh generation.

## Related Files

- `client/lib/__tests__/offline-queue-drain.test.ts` — constructs `ApiError`
  via dynamic import inside each test that feeds the drain's `instanceof`.
- `client/lib/api-error.ts` — the `ApiError` class the drain narrows on.
- `client/lib/offline-queue-drain.ts` — `error instanceof ApiError` status
  classification in `attemptDrain`'s catch block.

## See Also

- [vi.resetModules + dynamic import for env-dependent module testing](../design-patterns/vi-resetmodules-for-env-dependent-testing-2026-05-13.md)
  — the env-constant sibling case.
- [Mocking class constructors in vi.mock](../design-patterns/mocking-class-constructors-vi-mock-2026-05-13.md)
  — the related "use a real class, not a factory" mock gotcha.
