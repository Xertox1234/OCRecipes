---
title: An unconditional input mock makes guard-ordering tests vacuous — gate it with a hoisted toggle
track: knowledge
category: conventions
module: server
severity: medium
tags: [testing, vitest, routes, mocks, multer]
applies_to: [server/routes/**/__tests__/**/*.ts, server/routes/__tests__/*.test.ts]
created: '2026-05-31'
last_updated: '2026-05-31'
---

## Rule

When a route handler has **two early-return guards in sequence** (e.g.
`checkAiConfigured` → 503, then `requireValidImage` → 400) and you want a test
to pin their _relative order_, the test must drive the input that makes the two
orderings diverge. Two guards only diverge for the input each independently
rejects — here, a **missing file**. A test that supplies a valid file passes
under either ordering and proves nothing.

The trap: route-test mocks frequently inject the input **unconditionally**. The
multer mock in `cooking.test.ts` / `photos.test.ts` sets `req.file = {...}` on
every request, so _omitting_ `.attach()` does **not** produce an absent file.
Likewise the `vi.mock("../../lib/openai", ...)` factory hardcodes
`isAiConfigured: true`. To test the missing-file / unconfigured-service edge you
must make both mocks toggleable:

1. Add a `vi.hoisted` mutable holder per input (`mockFilePresent`,
   `mockAiConfigured`), and gate the mock body on `.current`. For the openai
   mock, expose `isAiConfigured` as a **getter** that reads the holder (a plain
   property is captured once at module-eval time and cannot change per-test).
2. **Reset every holder in `beforeEach`.** `vi.clearAllMocks()` does NOT reset a
   hoisted plain object — a leaked `false` silently breaks later tests that
   assume the input is present / the service is configured. (Same class of leak
   as the `mockResolvedValueOnce`-queue leak; see See Also.)
3. Add the **pair** of tests that pins the ordering: missing-input + service-off
   → first guard's code; missing-input + service-on → second guard's code.
4. **Discriminating check before declaring done:** locally swap the two guards
   and confirm the first test's expected code FLIPS. If it still passes with the
   guards reversed, the test isn't testing the ordering.

## When this applies

Any route-handler test that asserts the status code of one of several sequential
early-return guards, where a `vi.mock` factory or middleware mock injects the
guarded input unconditionally.

## Why

A guard-ordering test that doesn't exercise the divergent input is a false
positive: green, but it would stay green after a regression that reverses the
guards. The unconditional mock hides this because the "obvious" way to simulate
absence (omit `.attach()`) has no effect.

## Examples

Toggleable mocks (gate on a hoisted holder; openai via getter):

```ts
const { mockFilePresent } = vi.hoisted(() => ({
  mockFilePresent: { current: true },
}));
const { mockAiConfigured } = vi.hoisted(() => ({
  mockAiConfigured: { current: true },
}));

vi.mock("../../lib/openai", () => ({
  get isAiConfigured() {
    return mockAiConfigured.current;
  },
}));

vi.mock("multer", () => {
  const multerMock = () => ({
    single: () => (req, _res, next) => {
      if (mockFilePresent.current) {
        req.file = { buffer: mockFileBuffer.current, mimetype: "image/jpeg" } as Express.Multer.File;
      }
      next();
    },
  });
  multerMock.memoryStorage = () => ({});
  return { default: multerMock };
});

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks does NOT reset hoisted plain objects — a leaked false breaks later tests.
  mockFilePresent.current = true;
  mockAiConfigured.current = true;
});

it("returns 503 (not 400) when file is missing and AI is unconfigured", async () => {
  mockFilePresent.current = false;
  mockAiConfigured.current = false;
  // ... expect(res.status).toBe(503);
});
it("returns 400 when file is missing and AI is configured", async () => {
  mockFilePresent.current = false;
  mockAiConfigured.current = true;
  // ... expect(res.status).toBe(400);
});
```

## Related Files

- `server/routes/__tests__/cooking.test.ts` — `mockFilePresent` / `mockAiConfigured` toggles + the two ordering tests.
- `server/routes/cooking.ts` — photos handler; intentional `checkAiConfigured`-before-`requireValidImage` order with a documenting comment.
- `server/routes/_helpers.ts` — `checkAiConfigured` (503) and `requireValidImage` (400) guards.

## See Also

- `docs/solutions/conventions/vitest-clearallmocks-leaks-once-queue-2026-05-16.md` — the analogous `clearAllMocks` non-reset of stateful mock fixtures.
- `docs/solutions/design-patterns/service-availability-guard-check-ai-configured-2026-05-13.md` — the 503 service-availability guard convention.
