---
title: Atomic counter / version increments via SQL
track: knowledge
category: conventions
module: server
tags: [database, drizzle, sql, atomic, race-condition, counter]
applies_to: [server/storage/**/*.ts]
created: '2026-05-13'
---

# Atomic counter / version increments via SQL

## Rule

When incrementing a counter or version column (e.g. `tokenVersion`, `hitCount`, `viewCount`), use a SQL expression instead of a read-then-write pattern. This avoids race conditions where two concurrent requests read the same value and both write `value + 1`, losing one increment.

## Examples

```typescript
// ❌ BAD: read-then-write race condition
const user = await db.select().from(users).where(eq(users.id, userId));
await db
  .update(users)
  .set({ tokenVersion: user.tokenVersion + 1 })
  .where(eq(users.id, userId));

// ✅ GOOD: atomic SQL increment
import { sql } from "drizzle-orm";

await db
  .update(users)
  .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
  .where(eq(users.id, userId));
```

## When to use

Any integer column that is incremented from its current value — counters, versions, sequence numbers.

## Why

Even single-server deployments can have concurrent requests. The SQL approach delegates atomicity to the database, making it correct regardless of concurrency model.

## Related Files

- `server/storage/users.ts` — `incrementTokenVersion()`

## See Also

- [Token versioning for JWT revocation](../design-patterns/token-versioning-jwt-revocation-2026-05-13.md)
