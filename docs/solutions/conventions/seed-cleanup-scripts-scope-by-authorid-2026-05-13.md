---
title: "Seed/cleanup scripts must scope by authorId, not just name"
track: knowledge
category: conventions
tags: [security, data-loss, seed-scripts, cleanup, authorid]
module: server
applies_to: ["server/scripts/**/*.ts"]
created: 2026-05-13
---

# Seed/cleanup scripts must scope by authorId, not just name

## Rule

Any script that deletes rows based on name patterns (test data, seed recipes, demo fixtures) MUST also scope the WHERE clause by an identity column (`authorId`, `userId`, `ownerId`) that distinguishes script-generated rows from real user data. Name matches alone are a ticking data-loss bomb — a real user can create a row whose name happens to match the pattern.

## Examples

```typescript
// ❌ Bad: deletes ANY row where normalizedProductName matches, regardless of author
const TEST_PRODUCT_NAMES = ["test product", "test food", "original pasta"];
const junkRecipes = await db
  .select(...)
  .from(communityRecipes)
  .where(
    or(
      ilike(communityRecipes.normalizedProductName, "seed-%"),
      inArray(communityRecipes.normalizedProductName, TEST_PRODUCT_NAMES),
    ),
  );
// A real user recipe titled "Original Pasta" gets wiped along with their
// cookbook entries, favourites, dismissals, and image file.
```

```typescript
// ✅ Good: restrict to orphan (authorId IS NULL) or the known seed-author,
// AND match by prefix convention (no hand-maintained name allowlist)
const demoUserRows = await db
  .select({ id: users.id })
  .from(users)
  .where(eq(users.username, "demo"));
const demoUserId = demoUserRows[0]?.id ?? null;

const authorIdCondition = demoUserId
  ? or(
      isNull(communityRecipes.authorId),
      eq(communityRecipes.authorId, demoUserId),
    )
  : isNull(communityRecipes.authorId);

const junkRecipes = await db
  .select(...)
  .from(communityRecipes)
  .where(
    and(
      authorIdCondition,
      or(
        ilike(communityRecipes.normalizedProductName, "seed-%"), // seed script
        ilike(communityRecipes.normalizedProductName, "test-%"), // Vitest data
        // back-compat for pre-prefix-convention dev DBs only
        inArray(
          communityRecipes.normalizedProductName,
          LEGACY_TEST_PRODUCT_NAMES,
        ),
      ),
    ),
  );
```

## Why

Name patterns collide accidentally. `authorId` is either a known demo/seed user OR `NULL` (orphan from cascaded user delete) — real users always have a non-null, non-demo `authorId` and are automatically excluded.

## Additional defensive measures

1. Gate destructive scripts on `NODE_ENV !== "production"` unless explicitly overridden with a flag.
2. Add a `--dry-run` mode that logs what would be deleted without committing.
3. Log `id` + `title` + `authorId` tuples before deletion so a reviewer can audit.
4. Use a **prefix convention** (`seed-`, `test-`) on the matched column so new fixtures are caught automatically — no allowlist coordination cost. Test factories that insert into `communityRecipes` MUST set `normalizedProductName` starting with `test-` (L-4, audit 2026-04-17). The pure classifier in `server/scripts/cleanup-seed-recipes-utils.ts` is unit-tested against this contract so a refactor that drops the prefix branch will fail CI.

## Origin

2026-04-17 audit H1 — `cleanup-seed-recipes.ts` had `TEST_PRODUCT_NAMES` including `"original pasta"` with no `authorId` guard; a user recipe with that name would be silently deleted. 2026-04-18 (L-4 follow-up): switched the inner name filter from hand-maintained allowlist to `seed-%` / `test-%` prefix so new test fixtures don't require touching cleanup scripts.

## Related Files

- `server/scripts/cleanup-seed-recipes-utils.ts` — pure classifier with unit tests
- `server/scripts/cleanup-seed-recipes.ts` — cleanup script
