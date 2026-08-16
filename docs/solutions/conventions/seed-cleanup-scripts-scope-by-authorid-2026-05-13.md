---
title: 'Seed/cleanup scripts must scope by authorId, not just name'
track: knowledge
category: conventions
module: server
tags: [security, data-loss, seed-scripts, cleanup, authorid]
applies_to: [server/scripts/**/*.ts, scripts/**/*.ts]
created: '2026-05-13'
last_updated: '2026-08-16'
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
5. **Test BOTH branches of the `demoUserId` ternary structurally, not just the demo-id branch.** `authorIdCondition` is `demoUserId ? or(isNull(...), eq(...)) : isNull(...)` — two SQL shapes, not one. A test suite that only pins the demo-id branch's `(...) and (...)` conjunct shape (e.g. `expect(sql).toMatch(/\(.*author_id.*\)\s+and\s+\(/)`) never exercises the `null` branch's rendering, and `isNull(...)` renders **unparenthesized** (`"author_id" is null and (...)`, not `(...) and (...)`) — so a copy-pasted regex from the demo-id test would falsely pass OR falsely fail there; either way it isn't proving anything. The `null` branch is also the one silently reached whenever the demo-user lookup fails to resolve (misconfigured/renamed demo username, empty result) — exactly the failure mode most likely to go unnoticed in production. Pin both branches with their own structural assertion, and add a two-sided negative control (`docs/rules/harness.md`) that builds the flattened `or(authorCond, ...criteria)` shape and asserts each pin correctly rejects it — verify this empirically by hand-mutating the source to the flattened form and confirming the tests go red, not just by reasoning about the regex. (Found in review 2026-08-16: `server/scripts/__tests__/cleanup-seed-recipes-utils.test.ts:49` — the very file this convention was drawn from — has this exact gap; the null-branch test there asserts `contains('"author_id" is null')` but never pins the AND-not-OR conjunct structure. Not yet fixed there — flagged as a deferred warning, out of scope for the todo that surfaced it.)

## Origin

2026-04-17 audit H1 — `cleanup-seed-recipes.ts` had `TEST_PRODUCT_NAMES` including `"original pasta"` with no `authorId` guard; a user recipe with that name would be silently deleted. 2026-04-18 (L-4 follow-up): switched the inner name filter from hand-maintained allowlist to `seed-%` / `test-%` prefix so new test fixtures don't require touching cleanup scripts. 2026-08-16: `scripts/cleanup-junk-recipes.ts` (a top-level operator script, not under `server/scripts/`) had the same no-authorId-scoping gap for its `communityRecipes` deletion predicate — fixed by copying this convention's `authorIdCondition` shape verbatim; review surfaced the both-branches structural-test gap (measure 5 above) and widened `applies_to` to cover `scripts/**/*.ts` too.

## Related Files

- `server/scripts/cleanup-seed-recipes-utils.ts` — pure classifier with unit tests
- `server/scripts/cleanup-seed-recipes.ts` — cleanup script
- `scripts/cleanup-junk-recipes-utils.ts` — second application of this convention (top-level operator script, community recipe deletion)
- `scripts/cleanup-junk-recipes.ts` — cleanup script
- `scripts/__tests__/cleanup-junk-recipes-utils.test.ts` — both-branches structural pins + two-sided negative control (measure 5)
