---
title: Streak calculation from time-series data
track: knowledge
category: design-patterns
module: server
tags: [database, drizzle, sql, time-series, aggregation, streaks]
applies_to: [server/storage/**/*.ts]
created: '2026-05-13'
---

# Streak calculation from time-series data

## When this applies

Calculate activity streaks by querying distinct UTC dates and walking backwards.

## Examples

```typescript
// Get distinct dates ordered most recent first
const dates = await db
  .select({
    day: sql<string>`DATE(${table.createdAt} AT TIME ZONE 'UTC')`,
  })
  .from(table)
  .where(eq(table.userId, userId))
  .groupBy(sql`DATE(${table.createdAt} AT TIME ZONE 'UTC')`)
  .orderBy(sql`DATE(${table.createdAt} AT TIME ZONE 'UTC') DESC`);

// Walk backwards counting consecutive days
let streak = 0;
let expectedDate = new Date(today);
for (const row of dates) {
  const d = new Date(row.day);
  const diffDays = Math.round(
    (expectedDate.getTime() - d.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diffDays === 0) {
    streak++;
    expectedDate.setUTCDate(expectedDate.getUTCDate() - 1);
  } else if (diffDays === 1 && streak === 0) {
    // Yesterday counts as start (user hasn't acted today yet)
    streak++;
    expectedDate = new Date(d);
    expectedDate.setUTCDate(expectedDate.getUTCDate() - 1);
  } else {
    break;
  }
}
```

## Key details

- Use `AT TIME ZONE 'UTC'` to normalize across server timezones
- Allow yesterday as streak start (grace period for users who haven't acted today yet)
- `GROUP BY DATE(...)` collapses multiple same-day entries into one row
- More efficient than fetching all rows — only fetches distinct dates

## Related Files

- `server/storage/verification.ts` — `getUserVerificationStats()` for verification streaks

## See Also

- [Multi-source streak dates (UNION, not GREATEST)](multi-source-streak-dates-union-not-greatest-2026-05-13.md)
