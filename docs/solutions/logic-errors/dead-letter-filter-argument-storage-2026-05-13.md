---
title: 'Dead-letter filter argument: storage accepts a filter it never applies'
track: bug
category: logic-errors
module: server
severity: high
tags: [storage, type-safety, api-drift, contract-bug, drizzle]
symptoms: [Personalization filter appears in type signature but UI never reflects it, 'Two prior fixes for symptoms further upstream (cache invalidation, write-through) didn''t fix the bug', DB query silently ignores a parameter callers expect to filter by]
applies_to: [server/storage/**/*.ts]
created: '2026-05-10'
---

# Dead-letter filter argument: storage accepts a filter it never applies

## Problem

`getRecentCommunityRecipes(userId, filters)` accepted `cuisinePreferences`, `dietType`, and `allergies` in its `RecentRecipeFilters` interface — but the SQL builder only filtered on `isPublic`, `imageUrl`, and `dismissedIds`. The three personalization filters were dead letters: callers (carousel-builder) passed them in expecting filtering, the type signature implied filtering, the DB query silently dropped them on the floor.

This created a cascading bug where two prior fixes correctly addressed downstream symptoms (client cache invalidation, write-through of `cuisinePreferences`), but the actual recipes returned to the carousel didn't reliably contain any whose `dietTags` matched the user's cuisine prefs — so the `generateCommunityReason()` cuisine branch never fired.

## Symptoms

- Carousel cuisine-match labels never appear despite user preferences set in the profile
- Multiple "fix" attempts in adjacent layers fail to resolve the visible bug
- Storage function type signature looks correct in isolation

## Root Cause

When a storage function's parameter is in the type signature but unused in the query, it's a contract bug, not a code smell. The type system happily accepts the input, callers happily provide it, and the SQL query silently discards it.

```typescript
// Bad — caller passes cuisinePreferences expecting filtering; SQL ignores it
export async function getX(
  userId: string,
  filters: {
    cuisinePreferences?: string[]; // never referenced below
    limit?: number;
  },
) {
  return db.select().from(table).where(eq(table.userId, userId));
}
```

## Solution

Either wire the parameter into the query (boost via `ORDER BY`, or filter via `WHERE`), or remove it from the type:

```typescript
// Boost (preserves a full result set when no match):
//   ORDER BY (CASE WHEN <match> THEN 0 ELSE 1 END), <secondary>

// Filter (drops non-matching rows):
//   WHERE <match-condition>
```

## Prevention

**Investigation checklist for "labels/personalization didn't apply" bugs:**

1. Does the client invalidate the right query key after the mutation?
2. Does the mutation actually write the field to the DB?
3. **Does the read path actually consume the field?** — most often missed.

When reviewing storage functions, grep each `filters.<key>` against the SQL builder body — if a parameter is declared but never appears in `.where()` / `.orderBy()` / `.having()`, the contract is broken.

## Related Files

- `server/storage/carousel.ts` — `getRecentCommunityRecipes`
- `todos/2026-05-10-fix-carousel-cuisine-labels.md`
