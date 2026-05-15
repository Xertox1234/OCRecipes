---
title: "Split storage test files to match new module boundaries"
status: in-progress
priority: low
created: 2026-04-27
updated: 2026-04-27
labels: [testing, architecture]
---

# Split storage test files to match new module boundaries

## Summary

After the M11 storage decomposition (commit `1661c0c`), three new storage modules exist — `grocery-lists.ts`, `pantry.ts`, `health.ts` — but their tests still live in the parent module's test files (`meal-plans.test.ts`, `users.test.ts`). The project convention is one test file per storage module.

## Background

The M11 refactor extracted grocery list, pantry, and health functions from `meal-plans.ts` and `users.ts` into dedicated modules. The test imports were correctly updated to point at the new source files, so **coverage is complete** — this is a convention gap, not a coverage gap.

All other storage modules follow one-to-one correspondence: `cache.ts` ↔ `cache.test.ts`, `fasting.ts` ↔ `fasting.test.ts`, etc. Three new modules now break that pattern:

- `server/storage/grocery-lists.ts` → tests in `meal-plans.test.ts`
- `server/storage/pantry.ts` → tests in `meal-plans.test.ts`
- `server/storage/health.ts` → tests in `users.test.ts`

`recipe-from-chat.ts` is intentionally excluded — its tests remain in `chat.test.ts` because the function deeply involves `chatMessages` and `chatConversations` fixtures already set up there.

## Acceptance Criteria

- [ ] `server/storage/__tests__/grocery-lists.test.ts` created, containing all grocery list tests moved from `meal-plans.test.ts`
- [ ] `server/storage/__tests__/pantry.test.ts` created, containing all pantry tests moved from `meal-plans.test.ts`
- [ ] `server/storage/__tests__/health.test.ts` created, containing all weight log and HealthKit tests moved from `users.test.ts`
- [ ] `meal-plans.test.ts` retains only meal plan recipe and meal plan item tests
- [ ] `users.test.ts` retains only user account management tests
- [ ] `npm run test:run` passes with the same test count (no tests added or removed, just relocated)

## Implementation Notes

- Move test blocks wholesale — do not rewrite test logic
- Each new test file needs its own db/schema imports and any shared `beforeEach`/`afterEach` setup currently in the parent file
- Check for shared `testUserId` or fixture setup at the top of `meal-plans.test.ts` and `users.test.ts` — these will need to be duplicated or extracted into a shared helper

Files to create:

- `server/storage/__tests__/grocery-lists.test.ts`
- `server/storage/__tests__/pantry.test.ts`
- `server/storage/__tests__/health.test.ts`

Files to modify:

- `server/storage/__tests__/meal-plans.test.ts`
- `server/storage/__tests__/users.test.ts`

## Dependencies

- None (M11 decomposition is complete)

## Risks

- Shared test setup (db seeds, `testUserId`) in the parent test files may need careful extraction to avoid duplication — read both files fully before moving any blocks

## Updates

### 2026-04-27

- Initial creation — surfaced by code review of commit `1661c0c`
