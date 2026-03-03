---
title: "Test server storage layer"
status: backlog
priority: medium
created: 2026-02-25
updated: 2026-02-25
assignee:
labels: [testing, server, storage, infrastructure]
---

# Test Server Storage Layer

## Summary

Create tests for the 11 server storage modules that have 0% coverage, totaling 2,179 lines of untested Drizzle ORM query logic. This requires an architectural decision on the testing approach: integration tests with a test database, or unit tests with a mocked Drizzle `db` object.

## Background

The storage layer (`server/storage/`) contains all database interaction logic using Drizzle ORM. Currently, route tests mock the entire storage layer, which means storage code itself is never exercised. The only tested file is `index.ts` (the barrel export) at 100%, and `helpers.ts` at 17%.

This is 2,339 lines of code with 0.6% overall coverage — the largest untested code area by coverage percentage. However, since route tests already validate business logic by mocking storage, the marginal value of storage tests is debatable. The main benefit would be catching Drizzle query construction bugs.

## Acceptance Criteria

- [ ] Decide on testing approach (integration vs unit — see notes below)
- [ ] `server/storage/users.ts` — 152 lines (user CRUD, profile management)
- [ ] `server/storage/nutrition.ts` — 379 lines (scanned items, daily logs, nutrition cache)
- [ ] `server/storage/meal-plans.ts` — 663 lines (meal plan CRUD, recipes, ingredients)
- [ ] `server/storage/activity.ts` — 234 lines (exercise logs, exercise library)
- [ ] `server/storage/cache.ts` — 225 lines (suggestion/instruction/nutrition caches)
- [ ] `server/storage/community.ts` — 166 lines (community recipes)
- [ ] `server/storage/chat.ts` — 139 lines (chat sessions, messages)
- [ ] `server/storage/fasting.ts` — 84 lines (fasting schedules, logs)
- [ ] `server/storage/medication.ts` — 83 lines (medication logs)
- [ ] `server/storage/menu.ts` — 35 lines (menu analysis)
- [ ] `server/storage/helpers.ts` — 19 lines (utility functions)
- [ ] All tests pass alongside existing 1,135 tests

## Implementation Notes

### Option A: Integration Tests with Test Database (Recommended)

**Pros**: Tests real Drizzle queries, catches SQL bugs, high confidence
**Cons**: Requires PostgreSQL, slower, CI setup needed

Approach:
1. Create a `test.env` with a test database URL (e.g., `nutriscan_test`)
2. Use Drizzle `migrate` or `push` to set up schema before tests
3. Use transactions with rollback for test isolation:
   ```typescript
   beforeEach(async () => {
     await db.execute(sql`BEGIN`);
   });
   afterEach(async () => {
     await db.execute(sql`ROLLBACK`);
   });
   ```
4. Or truncate tables between tests
5. Test each storage method: insert → read → update → delete cycles

### Option B: Unit Tests with Mocked `db`

**Pros**: No database needed, fast, CI-friendly
**Cons**: Tests mock behavior not real queries, lower confidence, brittle mocks

Approach:
1. Mock `../db` to return a mock `db` object
2. Mock Drizzle's query builder chain (`select().from().where()...`)
3. Verify correct table/column/condition usage
4. Less valuable since it tests mock behavior

### Priority Order (by file size and criticality)

1. **meal-plans.ts** (663 lines) — Most complex, many JOINs
2. **nutrition.ts** (379 lines) — Core feature, complex queries
3. **activity.ts** (234 lines) — Exercise tracking queries
4. **cache.ts** (225 lines) — Cache invalidation logic
5. **community.ts** (166 lines) — Community recipe queries
6. **users.ts** (152 lines) — Auth-critical, user profile management
7. **chat.ts** (139 lines) — Chat history queries
8. **fasting.ts** (84 lines), **medication.ts** (83 lines), **menu.ts** (35 lines), **helpers.ts** (19 lines) — smaller files

### Existing Test Reference

`server/__tests__/storage.test.ts` already exists and tests the storage interface (verifies all methods exist). This provides a pattern for the barrel export but doesn't test any actual query logic.

## Dependencies

- **Option A**: PostgreSQL instance (local or Docker), test database setup, possibly `docker-compose.test.yml`
- **Option B**: Deep understanding of Drizzle ORM query builder internals for mocking
- Schema file at `shared/schema.ts` defines all tables
- `drizzle.config.ts` for DB push configuration

## Risks

- **Option A**: Adds CI complexity (PostgreSQL service), test database migration management, slower test runs (~5-10s per storage file vs ~1s for mocked tests)
- **Option B**: Mocking Drizzle's fluent query builder is error-prone and brittle — chain methods like `.select().from().where().innerJoin()` are hard to mock correctly
- **Diminishing returns**: Route tests already validate that the right storage methods are called with the right arguments. Storage tests would catch Drizzle query bugs but not business logic bugs.
- **meal-plans.ts** at 663 lines has complex multi-table JOINs that may be the most valuable to integration-test but also the hardest

## Updates

### 2026-02-25
- Initial creation after Round 3 audit
- 11 storage files identified with 0% coverage (2,179 lines)
- Architectural decision needed before implementation
