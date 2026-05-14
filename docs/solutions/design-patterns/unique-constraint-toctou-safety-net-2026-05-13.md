---
title: "Unique constraint as TOCTOU safety net"
track: knowledge
category: design-patterns
tags:
  [
    database,
    drizzle,
    unique-constraint,
    race-condition,
    postgres,
    error-handling,
  ]
module: server
applies_to:
  ["server/routes/**/*.ts", "server/storage/**/*.ts", "shared/schema.ts"]
created: 2026-05-13
---

# Unique constraint as TOCTOU safety net

## When this applies

When the "check-then-insert" race window is narrow (no expensive work between check and insert) and the uniqueness is inherent to the data model, use a database unique constraint as the safety net instead of a full transaction. Keep the application-level check for a fast, friendly response, and catch the constraint violation in the error handler.

## Examples

```typescript
// ✅ GOOD: App-level check for fast 409 + unique constraint catches the race
// Route: POST /api/auth/register
const existingUser = await storage.getUserByUsername(username);
if (existingUser) {
  return sendError(res, 409, "Username already exists", ErrorCode.CONFLICT);
}

let user;
try {
  user = await storage.createUser({ username, password: hashedPassword });
} catch (err) {
  const msg = toError(err).message;
  if (msg.includes("23505") || msg.includes("unique")) {
    return sendError(res, 409, "Username already exists", ErrorCode.CONFLICT);
  }
  throw err; // Re-throw non-constraint errors
}
```

## When to use

- Uniqueness is already enforced by a DB constraint (username, email, one-confirmation-per-item)
- The insert is the only write operation (no multi-table atomicity needed)
- The race window is narrow (no AI calls or external APIs between check and insert)

## Exceptions

- Multi-table mutations that must be atomic (use a transaction instead)
- Count-based limits (e.g., "max 5 per day") where there's no single unique key

## Key

PostgreSQL error code `23505` is the unique violation. Drizzle surfaces it in the error message. Always re-throw non-23505 errors.

## Related Files

- `server/routes/auth.ts` — registration username uniqueness
- `server/routes/meal-plan.ts` — meal plan confirmation dedup (partial unique index on `userId, mealPlanItemId` where not null)
- `shared/schema.ts` — `daily_logs_unique_meal_plan_confirm` partial unique index

## See Also

- [Transaction-wrapped count-then-insert to prevent TOCTOU](transaction-wrapped-count-then-insert-toctou-2026-05-13.md)
- [TOCTOU race recovery via unique constraint catch](toctou-race-recovery-unique-constraint-catch-2026-05-13.md)
- [Toggle via transaction to prevent duplicate inserts](toggle-via-transaction-prevent-duplicate-inserts-2026-05-13.md)
