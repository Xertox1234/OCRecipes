---
title: 'Storage-layer defense-in-depth: include userId in mutation WHERE clauses'
track: knowledge
category: conventions
module: server
tags: [security, idor, storage, drizzle, defense-in-depth]
applies_to: [server/storage/**/*.ts]
created: '2026-05-13'
---

# Storage-layer defense-in-depth: include userId in mutation WHERE clauses

## When this applies

Any `IStorage` method that updates or deletes a row in a user-owned table by primary key (`id`). Route-level ownership checks are the primary defense, but the storage mutation should also include `userId` in its WHERE clause so a different code path that forgets the ownership check cannot be exploited.

## When NOT to use

- Methods that operate on non-user-scoped resources (e.g., shared recipe catalog).
- Read-only methods on junction/child tables without a `userId` column — see junction-table-reads pattern instead.

## Examples

```typescript
// ❌ Bad: Storage method trusts the caller to pass the right ID
async endFastingLog(id: number, ...): Promise<FastingLog | undefined> {
  const [updated] = await db.update(fastingLogs)
    .set({ ... })
    .where(eq(fastingLogs.id, id))  // No userId check!
    .returning();
  return updated || undefined;
}

// ✅ Good: Storage method enforces ownership itself
async endFastingLog(id: number, userId: string, ...): Promise<FastingLog | undefined> {
  const [updated] = await db.update(fastingLogs)
    .set({ ... })
    .where(and(eq(fastingLogs.id, id), eq(fastingLogs.userId, userId)))
    .returning();
  return updated || undefined;
}
```

## Why

A route may look safe because it first looks up the active record by `userId` and then passes the `id` to the storage mutation. But if a future code path calls the mutation directly with an untrusted `id`, the missing `userId` filter becomes an IDOR vulnerability. Adding `userId` to the WHERE clause makes the storage layer independently safe regardless of how it is called. The cost is one extra parameter; the benefit is defense-in-depth against authorization bypass.

## Related Files

- `server/storage.ts` — `endFastingLog`, `deleteMenuScan`, `deleteMedicationLog`, `softDeleteScannedItem`
- LEARNINGS.md — "IDOR in Micronutrients and Chat Routes"

## See Also

- [IDOR protection: auth + ownership check](idor-protection-auth-ownership-check-2026-05-13.md)
- [Junction table reads via innerJoin through parent](../design-patterns/junction-table-reads-innerjoin-ownership-2026-05-13.md)
- [Wire optional defense-in-depth parameters at every call site](wire-optional-defense-in-depth-parameters-2026-05-13.md)
