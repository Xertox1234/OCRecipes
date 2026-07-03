---
title: Storage integration tests with transaction rollback
track: knowledge
category: design-patterns
module: server
tags: [testing, vitest, drizzle, postgres, integration-tests, storage]
applies_to: [server/storage/**/__tests__/**/*.ts]
created: '2026-05-13'
---

# Storage integration tests with transaction rollback

## When this applies

For testing storage functions against a real database, use the `setupTestTransaction` / `rollbackTestTransaction` utilities to run each test inside a transaction that rolls back after the test — leaving the DB clean.

The key technique: mock the `db` import so all storage functions use the test transaction instead of the real connection pool.

## Why

Real-DB integration tests catch bugs that storage-mock tests cannot (advisory-lock races, unique-constraint conflicts, transactional integrity). Per-test transactions give isolation without manual cleanup; rollback returns the database to its pre-test state.

## Examples

```typescript
// server/storage/__tests__/favourite-recipes.test.ts
import {
  setupTestTransaction,
  rollbackTestTransaction,
  closeTestPool,
  createTestUser,
  getTestTx,
} from "../../../test/db-test-utils";

// Redirect all storage functions to the test transaction
vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

// Import AFTER mocking — dynamic import ensures the mock is applied
const { toggleFavouriteRecipe, getFavouriteRecipeCount } = await import(
  "../favourite-recipes"
);

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;

beforeEach(async () => {
  tx = await setupTestTransaction();
  testUser = await createTestUser(tx);
});

afterEach(async () => {
  await rollbackTestTransaction();
});
afterAll(async () => {
  await closeTestPool();
});
```

## Gotcha — `fireAndForget` in tests

Code using `fireAndForget()` executes asynchronously and the caller ignores the return value. Mocking it to return the promise does NOT make it synchronous. Capture the promise in a variable and await it explicitly:

```typescript
let lastFireAndForgetPromise: Promise<unknown> | null = null;
vi.mock("../../lib/fire-and-forget", () => ({
  fireAndForget: (_label: string, promise: Promise<unknown>) => {
    lastFireAndForgetPromise = promise;
  },
}));

// In test:
beforeEach(() => {
  lastFireAndForgetPromise = null;
});

it("cleans up orphans", async () => {
  await getResolvedFavouriteRecipes(userId);
  await lastFireAndForgetPromise; // Wait for the background cleanup
  const count = await getFavouriteRecipeCount(userId);
  expect(count).toBe(0);
});
```

## Exceptions

Simple CRUD storage functions where route-level tests already provide sufficient coverage via mocked storage. Use real-DB integration tests for transactional logic (advisory locks, unique constraint races, orphan cleanup, limit enforcement).

## Related Files

- `server/storage/__tests__/favourite-recipes.test.ts` — 24 integration tests
- `test/db-test-utils.ts` — shared transaction setup/teardown utilities

## See Also

- [Dual-assertion IDOR test for storage functions](../best-practices/dual-assertion-idor-test-2026-05-13.md)
- [`TIMESTAMP WITHOUT TIME ZONE` round-trip in real-DB tests](timestamp-without-tz-roundtrip-real-db-tests-2026-05-13.md)
