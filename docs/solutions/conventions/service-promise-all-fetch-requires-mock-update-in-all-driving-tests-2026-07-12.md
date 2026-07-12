---
title: Adding a storage fetch to a service's Promise.all requires a mock update in EVERY test file that drives that service
track: knowledge
category: conventions
tags: [testing, vitest, storage-mocks, promise-all, coach]
module: server
applies_to: ["server/services/**/*.ts", "server/routes/__tests__/**/*.ts", "server/services/__tests__/**/*.ts"]
created: 2026-07-12
---

# Adding a storage fetch to a service's Promise.all requires a mock update in EVERY test file that drives that service

## Rule

When you add a `storage.<fn>()` call inside a service's `Promise.all` (or anywhere on its happy path), grep for every test file that executes that service — not just its co-located suite — and add the new method to each file's explicit `vi.mock("../../storage", ...)` factory list plus its `setupDefault*` re-seeds (default `mockResolvedValue([])`). Route-level tests that `vi.importActual` the service module run the REAL service against the mocked storage facade.

## Smell patterns

- A route test failing with the route's generic error ("Failed to generate response") and `mock.calls[0]` undefined on a downstream spy — the real failure is `storage.newFn is not a function` rejecting the whole `Promise.all`, swallowed by the route's catch.
- A push-gate/CI failure in a test file the PR never touched.

## Why

The storage facade mocks in this repo are explicit method lists (per the all-or-nothing facade-mock rule), so a new method is `undefined` in every file that hasn't added it. One rejected fetch fails the entire `Promise.all`, and the route's error handling converts it into a misleading generic-error assertion diff far from the cause. In PR #583, adding `getCommitmentsWithDueFollowUp` broke `server/routes/__tests__/chat.test.ts` — a file the diff didn't touch — and only the pre-push related-tests gate caught it; the per-file TDD runs could not.

Find the driving files mechanically: `grep -rl "handleCoachChat\|<serviceFn>" server --include='*.test.ts'`.

## Exceptions

Test files that fully mock the service module itself (stubbing the function that contains the `Promise.all`) never execute the fetch and need no update.

## Related Files

- `server/routes/__tests__/chat.test.ts` — the non-co-located victim (storage mock list)
- `server/services/__tests__/coach-pro-chat.test.ts` — co-located suite, `setupDefaultStorage`

## See Also

- `docs/rules/testing.md` — the sibling rule for `fireAndForget(...)`-invoked services: route tests must mock every service the route fires, even unasserted ones
