---
title: Batch UPDATE via UPDATE … FROM (VALUES …)
track: knowledge
category: design-patterns
module: server
tags: [database, drizzle, sql, batch-update, performance, postgres]
applies_to: [server/storage/**/*.ts, server/scripts/**/*.ts]
created: '2026-05-13'
---

# Batch UPDATE via UPDATE … FROM (VALUES …)

## When this applies

When you need to write different values to N rows in one statement (e.g., a backfill that inferred a different `mealTypes` array per recipe), use a single `UPDATE … FROM (VALUES …)` round-trip. A `for (const row of rows) { await tx.update(...) }` loop inside a transaction issues N network round-trips and holds the tx open for N × RTT.

## Examples

```typescript
// ❌ Bad: N serial UPDATEs inside one tx — tx holds open for N × RTT
await db.transaction(async (tx) => {
  for (const { id, mealTypes } of updates) {
    await tx
      .update(mealPlanRecipes)
      .set({ mealTypes })
      .where(eq(mealPlanRecipes.id, id));
  }
});
```

```typescript
// ✅ Good: one round-trip, one tx commit
// Build a VALUES clause with explicit type casts (Postgres can't infer
// array/enum types from untyped literals)
const values = sql.join(
  updates.map(({ id, mealTypes }) => sql`(${id}::int, ${mealTypes}::text[])`),
  sql`, `,
);

await db.execute(sql`
  UPDATE meal_plan_recipes AS m
  SET meal_types = v.meal_types
  FROM (VALUES ${values}) AS v(id, meal_types)
  WHERE m.id = v.id
`);

// Refresh the in-memory search index with the new values
const store = getDocumentStore("meal-plan-recipes");
for (const { id, mealTypes } of updates) {
  const doc = store.get(`personal:${id}`);
  if (doc) addToIndex("meal-plan-recipes", { ...doc, mealTypes });
}
```

## Why VALUES over CASE WHEN

`CASE WHEN … THEN … END` scales linearly with N in SQL parse time and is harder to read past ~20 rows. `VALUES` is a single join and works well up to thousands of rows in one statement. For larger batches, chunk by ~1000 rows per `VALUES` call.

**Type casts matter.** Postgres infers `NULL` and array literals as `unknown`/`text[]` if you don't cast. Use `::int`, `::text[]`, `::jsonb` to match the target column type explicitly.

**Pair with index refresh.** If the updated column feeds an in-memory search index (MiniSearch, Lunr), the DB UPDATE doesn't refresh the index — you have to re-read `getDocumentStore(name)` and call `addToIndex(name, doc)` per row after the UPDATE commits. Skipping this step means search returns stale pre-backfill results until the next process restart. (Extends "Side-Effect Ordering Around `db.transaction`" — post-commit index writes apply to bulk mutations too.)

## Exceptions

When each row's update is conditional on a read computed during the same transaction (e.g., "increment counter only if not already at cap"). Use individual row UPDATEs with `WHERE` guards in that case.

**Origin:** 2026-04-18 audit H8 — `batchUpdateMealTypes` and `batchUpdateCommunityMealTypes` ran N serial UPDATEs inside one tx and never called `addToIndex`. A 50-recipe backfill was ~50× slower than needed AND MiniSearch returned stale results (no `breakfast` mealType tag) until server restart.

## See Also

- [CASE/WHEN batch update for reordering](case-when-batch-update-for-reordering-2026-05-13.md)
- [Side-effect ordering around db.transaction](../conventions/side-effect-ordering-around-db-transaction-2026-05-13.md)
