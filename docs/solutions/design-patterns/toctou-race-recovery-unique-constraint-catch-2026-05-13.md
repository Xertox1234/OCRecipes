---
title: TOCTOU race recovery via unique constraint catch
track: knowledge
category: design-patterns
module: server
tags: [database, drizzle, race-condition, postgres, error-handling, idempotency]
applies_to: [server/routes/**/*.ts]
created: '2026-05-13'
---

# TOCTOU race recovery via unique constraint catch

## When this applies

When a read-then-write pattern has a unique constraint as a safety net, catch the Postgres 23505 (unique_violation) error in the route handler and return the existing record. This turns a 500 error into a graceful idempotent response.

## Examples

```typescript
// Dedup check (TOCTOU: second request may pass this before first insert commits)
const existing = await storage.findByExternalId(userId, externalId);
if (existing) { res.json(existing); return; }

// ... create the record ...
const saved = await storage.createRecord(data);
res.status(201).json(saved);

// In the catch block:
} catch (error) {
  // Handle TOCTOU race: concurrent request created the record after our dedup check
  if (
    error instanceof Error &&
    "code" in error &&
    (error as { code: string }).code === "23505"
  ) {
    const existing = await storage.findByExternalId(userId, externalId);
    if (existing) { res.json(existing); return; }
  }
  handleRouteError(res, error, "create record");
}
```

## When to use

Endpoints that check for duplicates before insert, where a unique index prevents actual data duplication but concurrent requests can race past the dedup check.

## Exceptions

If the endpoint can use `onConflictDoUpdate` or `onConflictDoNothing` directly — that's simpler. This pattern is for cases where the insert is complex (e.g., inserts into multiple tables) and can't easily use `ON CONFLICT`.

## Prerequisites

The target table must have a unique constraint that catches the duplicate. Without it, the race creates actual duplicates.

## Related Files

- `server/routes/recipes.ts` — catalog recipe save endpoint
- Audit #6 M10

## See Also

- [Unique constraint as TOCTOU safety net](unique-constraint-toctou-safety-net-2026-05-13.md)
- [Transaction-wrapped count-then-insert to prevent TOCTOU](transaction-wrapped-count-then-insert-toctou-2026-05-13.md)
