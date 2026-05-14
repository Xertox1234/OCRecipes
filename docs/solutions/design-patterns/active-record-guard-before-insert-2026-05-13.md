---
title: "Active record guard before insert"
track: knowledge
category: design-patterns
tags: [database, lifecycle, conflict-detection, drizzle, routes]
module: server
applies_to: ["server/routes/**/*.ts", "server/storage/**/*.ts"]
created: 2026-05-13
---

# Active record guard before insert

## When this applies

When a table tracks resources with a lifecycle (start -> active -> end), prevent duplicate active records by checking for an existing row where the "ended" column is NULL before inserting a new one. Return 409 Conflict if an active record already exists.

## Examples

```typescript
// server/routes/fasting.ts — prevent starting a second fast
app.post(
  "/api/fasting/start",
  requireAuth,
  fastingRateLimit,
  async (req, res) => {
    // Check for active fast (endedAt IS NULL = still in progress)
    const [active] = await db
      .select()
      .from(fastingLogs)
      .where(
        and(
          eq(fastingLogs.userId, req.userId!),
          isNull(fastingLogs.endedAt), // Only active (unfinished) records
        ),
      );

    if (active) {
      return res.status(409).json({ error: "A fast is already in progress" });
    }

    // Safe to insert new active record
    const [log] = await db
      .insert(fastingLogs)
      .values({ userId: req.userId!, targetDurationHours: 16 })
      .returning();
    res.status(201).json(log);
  },
);
```

## When to use

- Fasting timers (only one active fast at a time)
- Workout sessions (only one in-progress workout)
- Any resource where "active" means a nullable end timestamp is NULL

## Exceptions

- Resources where multiple active records are valid (e.g., multiple active subscriptions on different products)
- Simple CRUD where lifecycle tracking is not needed

## Key elements

1. **`isNull(endedAt)`** is the active record filter — not a boolean `isActive` column
2. **Return 409 Conflict** — semantically correct for "resource already exists in this state"
3. **No transaction needed** for the read-then-insert if the unique constraint enforces at most one NULL `endedAt` per user (though a transaction adds safety for concurrent requests)

## Related Files

- `server/routes/fasting.ts` — `POST /api/fasting/start`
