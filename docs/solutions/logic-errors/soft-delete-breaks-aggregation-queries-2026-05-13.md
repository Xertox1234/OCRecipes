---
title: "Soft Delete Breaks Aggregation Queries Silently"
track: bug
category: logic-errors
tags: [soft-delete, sql, aggregation, drizzle, postgres]
module: server
applies_to: ["server/storage/**/*.ts"]
symptoms:
  - "Daily summary / aggregate totals include rows the user discarded"
  - "Discarded items still contribute to calorie / macro / count totals"
  - "Numbers look plausible but are inflated — no error, no test failure"
created: 2026-02-12
severity: high
---

# Soft Delete Breaks Aggregation Queries Silently

## Problem

After implementing soft delete (discard) on scanned items, the daily summary dashboard continued to include calories from discarded items. The bug was invisible because the aggregation returned a plausible number — just inflated. The `getDailySummary()` `LEFT JOIN` did not filter out discarded rows, and the fix required a compound `WHERE` because `scannedItemId` is nullable.

## Symptoms

- Daily summary totals are higher than the visible (non-discarded) item list implies.
- No exception, no test failure — the query returns a number, just the wrong one.
- The bug surfaces only when a user actually discards an item and re-opens the summary.

## Root Cause

Soft delete adds a `discardedAt` (or `deletedAt`) column but does not enforce its presence in downstream queries. Aggregations that read the table (or `LEFT JOIN` it) keep summing across discarded rows because they were authored before the soft-delete column existed, or because the author treated soft-delete as a UI concern.

The danger is specific to aggregations: SELECTs that hydrate a list will surface the missing filter via UI ("why is that discarded item still here?"), but aggregations produce a single number that nobody can spot-check.

When the soft-deleted entity participates in a join where the join column is nullable, the `WHERE` clause must be compound: filter on `discardedAt IS NULL` AND handle the nullable join column so unrelated rows aren't dropped.

## Solution

When adding a soft-delete column:

1. **Grep for every read of the affected table** — `SELECT`, `LEFT JOIN`, `INNER JOIN`, `EXISTS`, subqueries, aggregations.
2. **Aggregations first** — they're the highest-risk and lowest-signal class of consumer. Patch them before the visible list queries.
3. **Compound `WHERE` when the join column is nullable** — guard `discardedAt IS NULL` without accidentally filtering rows that legitimately have a `NULL` join column.

```typescript
// ❌ Bug: discarded items still aggregated
const summary = await db
  .select({ totalCalories: sum(nutritionLogs.calories) })
  .from(dailyEntries)
  .leftJoin(nutritionLogs, eq(nutritionLogs.entryId, dailyEntries.id))
  .where(eq(dailyEntries.userId, userId));

// ✅ Fix: compound WHERE handles nullable join + soft delete
const summary = await db
  .select({ totalCalories: sum(nutritionLogs.calories) })
  .from(dailyEntries)
  .leftJoin(nutritionLogs, eq(nutritionLogs.entryId, dailyEntries.id))
  .where(
    and(
      eq(dailyEntries.userId, userId),
      or(isNull(nutritionLogs.id), isNull(nutritionLogs.discardedAt)),
    ),
  );
```

## Prevention

- Treat soft-delete columns as a **schema-wide concern**, not a per-query concern. Maintain a checklist of every consumer at PR-review time.
- Add at least one regression test that discards an item and then re-reads any aggregation that touches the table.
- Where Drizzle helpers exist, wrap reads in a `notDiscarded(table)` helper so the filter is opt-out, not opt-in.

## Related Files

- `server/storage/nutrition.ts:249` — `getDailySummary()`

## See Also

- [optimistic-total-target-correct-page-2026-05-13.md](optimistic-total-target-correct-page-2026-05-13.md) — Client-side companion: discarding an item also corrupts paginated totals if the optimistic update targets the wrong page.
- `docs/patterns/database.md` — "Soft Delete with Aggregation Guard" (compound `WHERE` template)
