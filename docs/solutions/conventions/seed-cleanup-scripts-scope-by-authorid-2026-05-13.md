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

**Caveat — do not overstate it.** The seed author is resolved by `eq(users.username, "demo")`, and `demo` is **not** a reserved username: `registerSchema` (`server/routes/_schemas.ts`) enforces only 3-30 chars, `/^[a-zA-Z0-9_]+$/`, and uniqueness. In any environment where no demo account was seeded first, a real user can hold `demo` and their matching rows enter the perimeter. This scope **narrows** the blast radius; it does not close it. Never write "never touches a real user's row" in a comment, a PR body, or this doc — write "orphan, or the account currently holding the username `demo`".

## Additional defensive measures

1. Gate destructive scripts on `NODE_ENV !== "production"` unless explicitly overridden with a flag.
2. Add a `--dry-run` mode that logs what would be deleted without committing.
3. Log `id` + `title` + `authorId` tuples before deletion so a reviewer can audit.
4. Use a **prefix convention** (`seed-`, `test-`) on the matched column so new fixtures are caught automatically — no allowlist coordination cost. Test factories that insert into `communityRecipes` MUST set `normalizedProductName` starting with `test-` (L-4, audit 2026-04-17). The pure classifier in `server/scripts/cleanup-seed-recipes-utils.ts` is unit-tested against this contract so a refactor that drops the prefix branch will fail CI.
5. **Pin the EXACT rendered SQL for BOTH branches of the `demoUserId` ternary — a structural regex is necessarily partial.** `authorIdCondition` is `demoUserId ? or(isNull(...), eq(...)) : isNull(...)` — two SQL shapes, not one, and the `null` branch is the one silently reached whenever the demo-user lookup fails to resolve (misconfigured/renamed demo username, empty result), exactly the failure mode most likely to go unnoticed in production. Render with `new PgDialect().sqlToQuery(where)` and assert `expect(q.sql).toBe("<full rendered string>")` for each branch.

   - **A structural regex cannot hold this perimeter.** `expect(sql).toMatch(/\(.*author_id.*\)\s+and\s+\(/)` observes only that SOME author-scoped conjunct exists somewhere in the string. It is satisfied by a **partial escape** — `or(and(authorCond, or(a, b)), c)`, where one junk criterion has been hoisted OUT of the author scope and would delete any user's matching row — and that mutant also leaves the param list byte-identical, so `expect(q.params).toEqual([...])` pins pass it unchanged too. Widening a threshold inside the scope (`< 3` → `< 30`) likewise passes every regex. Only the full-string pin catches these. (Proven empirically 2026-08-16 on `scripts/__tests__/cleanup-junk-recipes-utils.test.ts`: two reviewers independently built the partial-escape mutant and it passed every assertion in the file.)
   - **Never `toMatchSnapshot()`.** A snapshot is re-blessed by `vitest -u` without anyone reading the diff — the quiet-disarm failure mode a permanent-DELETE perimeter can least afford. Use an inline literal so the reviewed diff *is* the SQL.
   - **Accept the reorder cost explicitly.** An exact pin also goes red on a semantically-equivalent conjunct reorder. For a permanent-DELETE predicate that is the correct trade, not a defect — say so in a comment next to the literal so the next reader updates it deliberately instead of loosening it.
   - **Two-sided negative control** (`docs/rules/harness.md`) covering BOTH escape shapes, per branch: the fully flattened `or(authorCond, ...criteria)` **and** the partial `or(and(authorCond, or(a, b)), c)`. Build the fixtures from the real criteria list — a fixture that drops the `and(...)` emptiness branch never exercises the one construct that contributes an `and` to the rendered string, so it isn't the shape the pin has to discriminate. Assert each fixture is rejected by the exact pin, and (for the partial escape) that it still **matches** the old loose regex — that single extra assertion proves the fixture really is the escape and documents why the regex was replaced.
   - **Verify RED by hand-mutating the source**, not by reasoning about the assertion or comparing strings in a scratch script: edit the predicate to the escape shape, run the suite, confirm it fails, revert, confirm green.

   (Found in review 2026-08-16: `server/scripts/__tests__/cleanup-seed-recipes-utils.test.ts` — the very file this convention was drawn from — had both gaps; its `null`-branch test asserted `contains('"author_id" is null')` and a param count but never pinned the AND-not-OR conjunct structure at all, and its demo-id test used the loose regex that a partial escape defeats. Flagged as a deferred warning, out of scope for the todos that surfaced it. **Fixed 2026-08-16** (todo `P3-2026-08-16-cleanup-seed-recipes-demo-branch-loose-pin`): the demo-id branch now pins an exact full-SQL `toBe` string alongside the pre-existing null-branch pin, plus a two-sided REGRESSION GUARD test covering both the flattened and partial escape shapes, mirroring `scripts/__tests__/cleanup-junk-recipes-utils.test.ts:105-148`.)

## Origin

2026-04-17 audit H1 — `cleanup-seed-recipes.ts` had `TEST_PRODUCT_NAMES` including `"original pasta"` with no `authorId` guard; a user recipe with that name would be silently deleted. 2026-04-18 (L-4 follow-up): switched the inner name filter from hand-maintained allowlist to `seed-%` / `test-%` prefix so new test fixtures don't require touching cleanup scripts. 2026-08-16: `scripts/cleanup-junk-recipes.ts` (a top-level operator script, not under `server/scripts/`) had the same no-authorId-scoping gap for its `communityRecipes` deletion predicate — fixed by copying this convention's `authorIdCondition` shape verbatim; review surfaced the both-branches structural-test gap (measure 5 above) and widened `applies_to` to cover `scripts/**/*.ts` too. A second review pass on the same PR then proved the structural-regex recipe measure 5 originally prescribed was itself insufficient (a partial escape defeats it) and rewrote it around an exact full-SQL pin, and corrected the "never touches a real user's recipe" claim to the accurate "orphan, or the account currently holding the username `demo`" (see the Why caveat).

## Related Files

- `server/scripts/cleanup-seed-recipes-utils.ts` — pure classifier with unit tests
- `server/scripts/cleanup-seed-recipes.ts` — cleanup script
- `server/scripts/__tests__/cleanup-seed-recipes-utils.test.ts` — exact full-SQL pins for both `demoUserId` branches + the flattened/partial-escape negative controls (measure 5)
- `scripts/cleanup-junk-recipes-utils.ts` — second application of this convention (top-level operator script, community recipe deletion)
- `scripts/cleanup-junk-recipes.ts` — cleanup script
- `scripts/__tests__/cleanup-junk-recipes-utils.test.ts` — exact full-SQL pins for both `demoUserId` branches + the flattened/partial-escape negative controls (measure 5)
