---
title: ".returning() to detect missing resources on UPDATE"
track: knowledge
category: conventions
tags: [database, drizzle, update, 404, error-handling]
module: server
applies_to: ["server/storage/**/*.ts", "server/routes/**/*.ts"]
created: 2026-05-13
---

# .returning() to detect missing resources on UPDATE

## Rule

When an UPDATE targets a specific row by ID (resolve, approve, archive operations), the query silently succeeds with 0 affected rows if the ID doesn't exist. Use `.returning()` and check the result length to distinguish "updated" from "not found."

## Examples

```typescript
// ✅ GOOD: Detect missing resource
export async function resolveReformulationFlag(
  id: number,
  resolution: string,
  resolvedBy: string,
): Promise<ReformulationFlag | undefined> {
  const [updated] = await db
    .update(reformulationFlags)
    .set({ status: "resolved", resolution, resolvedBy, resolvedAt: new Date() })
    .where(eq(reformulationFlags.id, id))
    .returning();
  return updated; // undefined if id doesn't exist
}

// Route handler:
const flag = await storage.resolveReformulationFlag(
  id,
  resolution,
  req.userId!,
);
if (!flag) {
  return sendError(res, 404, "Reformulation flag not found", "NOT_FOUND");
}
res.json(flag);
```

```typescript
// ❌ BAD: Silent success on missing resource
export async function resolveReformulationFlag(id: number, ...): Promise<void> {
  await db
    .update(reformulationFlags)
    .set({ status: "resolved", ... })
    .where(eq(reformulationFlags.id, id));
  // No .returning() — caller has no way to know if the row existed
}

// Route handler returns 200 even when id=999999 doesn't exist:
await storage.resolveReformulationFlag(id, resolution, req.userId!);
res.json({ message: "Resolved" }); // misleading
```

## When to use

- Any storage method that updates a specific row by primary key (resolve, archive, approve, reject)
- Admin operations on resources that may have been deleted concurrently
- Any endpoint where returning 200 for a nonexistent resource would be misleading

## Exceptions

- Bulk updates where 0 affected rows is a valid outcome (e.g., "mark all as read")
- Updates that include `userId` in the WHERE clause and already use the "return undefined for IDOR" pattern

## Why

Drizzle's `.update().where()` never throws on 0 matches — it silently succeeds. Without `.returning()`, the only way to detect this is a separate SELECT, which adds a round-trip and a TOCTOU window.

## Related Files

- `server/storage/reformulation.ts` — `resolveReformulationFlag()`

## See Also

- [Storage-layer defense-in-depth for IDOR](../conventions/storage-layer-idor-defense-in-depth-2026-05-13.md)
