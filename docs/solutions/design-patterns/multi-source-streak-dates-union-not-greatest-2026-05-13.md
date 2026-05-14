---
title: "Multi-source streak dates (UNION, not GREATEST)"
track: knowledge
category: design-patterns
tags: [database, drizzle, sql, time-series, streaks, gotchas]
module: server
applies_to: ["server/storage/**/*.ts"]
created: 2026-05-13
---

# Multi-source streak dates (UNION, not GREATEST)

## When this applies

When streak calculations need to consider multiple date sources from the same row (e.g., a `createdAt` date and a separate `frontLabelScannedAt` date), **do not use `GREATEST()`**. `GREATEST` picks one date and discards the other, which can erase an activity day from the distinct dates and retroactively break streaks.

## Examples

```typescript
// BAD: GREATEST collapses two dates into one, losing Monday if front-label was Wednesday
const dates = await db.select({
  day: sql`DATE(GREATEST(created_at, front_label_scanned_at) AT TIME ZONE 'UTC')`,
})...
```

```typescript
// GOOD: Query both date sources, merge with Set for distinct days
const backLabelDates = await db
  .select({
    day: sql`DATE(${table.createdAt} AT TIME ZONE 'UTC')`,
  })
  .from(table)
  .where(eq(table.userId, userId))
  .groupBy(sql`DATE(${table.createdAt} AT TIME ZONE 'UTC')`);

const frontLabelDates = await db
  .select({
    day: sql`DATE(${table.frontLabelScannedAt} AT TIME ZONE 'UTC')`,
  })
  .from(table)
  .where(
    and(
      eq(table.userId, userId),
      sql`${table.frontLabelScannedAt} IS NOT NULL`,
    ),
  )
  .groupBy(sql`DATE(${table.frontLabelScannedAt} AT TIME ZONE 'UTC')`);

const dateSet = new Set<string>();
for (const row of backLabelDates) dateSet.add(row.day);
for (const row of frontLabelDates) dateSet.add(row.day);
const dates = [...dateSet]
  .sort((a, b) => b.localeCompare(a))
  .map((day) => ({ day }));
```

## Why

A user verifies product A on Monday (`createdAt` = Monday). On Wednesday they front-label scan it (`frontLabelScannedAt` = Wednesday). `GREATEST` returns Wednesday — Monday vanishes. If Monday was the only activity that day, the streak breaks retroactively.

## Related Files

- `server/storage/verification.ts` — `getUserVerificationStats()` streak query

## See Also

- [Streak calculation from time-series data](streak-calculation-from-time-series-data-2026-05-13.md)
