---
title: Route tests must mock every service invoked via fireAndForget
track: knowledge
category: conventions
module: server
tags: [vitest, testing, mocks, test-isolation, api]
applies_to: [server/routes/__tests__/**/*.test.ts]
created: '2026-05-17'
---

## Rule

When a route handler kicks off background work with
`fireAndForget(label, serviceFn(...))`, the route's test file **must**
`vi.mock(...)` that service — even if the test never inspects the
service's result or asserts it was called.

A `fireAndForget` promise is intentionally not awaited by the handler.
The HTTP response returns (and the test's `await request(app)...`
resolves) **before** the background promise settles. If the service is
not mocked, the _real_ implementation runs on the microtask queue
_after_ the test has finished, and:

- it pulls its full transitive import graph into the worker (for
  `generateRecipeImage` that is `lib/openai` + `lib/runware`);
- it may make real network calls or touch the filesystem;
- when it settles it can call into _other_ mocked modules
  (e.g. `storage.updateMealPlanRecipe`), mutating that shared mock's
  call history for whichever test runs next in the same Vitest worker.

## When this applies

Adding or maintaining a `server/routes/__tests__/*.test.ts` file for a
route that calls `fireAndForget`. Grep the route module for
`fireAndForget(` and confirm every service named inside one is in the
test file's `vi.mock` list.

Note the trigger is the _factory default_, not the test body: if a
storage mock returns a fixture whose field gates the fire-and-forget
branch (`createMockMealPlanRecipe` defaults `imageUrl: null`, so
`if (!recipe.imageUrl)` is true), the background call fires on every
"happy path" test, not just one.

## Why

This is a cross-file test-isolation leak, not a code defect. It passes
the file in isolation (no later test to pollute) and fails
non-deterministically in a full suite run, depending on Vitest worker
file-ordering and CPU contention — the classic "flaky test" signature.
Mocking the service contains the background work: the mock resolves
synchronously on the microtask queue with no import graph, no I/O, and
no escape into other tests.

## Examples

```ts
// server/routes/meal-plan.ts — handler fires background work
if (!recipe.imageUrl) {
  fireAndForget(
    "recipe-image-gen",
    (async () => {
      const imageUrl = await generateRecipeImage(recipe.title, recipe.title);
      if (imageUrl) {
        await storage.updateMealPlanRecipe(recipe.id, req.userId, { imageUrl });
      }
    })(),
  );
}
```

```ts
// server/routes/__tests__/meal-plan.test.ts — REQUIRED mock
// generateRecipeImage runs as a fire-and-forget background promise;
// without this mock the real service leaks into later route tests.
vi.mock("../../services/recipe-generation", () => ({
  generateRecipeImage: vi.fn().mockResolvedValue(null),
}));
```

Use `mockResolvedValue(null)` (matching the real `Promise<string | null>`
signature) so the IIFE's `if (imageUrl)` branch is exercised cleanly
without triggering the follow-up `storage.updateMealPlanRecipe` call.

## Related Files

- `server/lib/fire-and-forget.ts` — the background-execution helper
- `server/routes/meal-plan.ts` — `POST /api/meal-plan/recipes` fires
  `generateRecipeImage` and `incrementRecipePopularity`
- `server/routes/__tests__/meal-plan.test.ts` — the fixed test file

## See Also

- `docs/solutions/conventions/vitest-singleton-mock-reset-2026-05-16.md`
- `docs/solutions/conventions/vitest-clearallmocks-leaks-once-queue-2026-05-16.md`
- `docs/solutions/conventions/module-level-cache-not-reset-between-tests-2026-05-13.md`
