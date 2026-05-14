---
title: "IDOR protection: auth + ownership check on every single-resource endpoint"
track: knowledge
category: conventions
tags: [security, idor, authorization, ownership, routes]
module: server
applies_to: ["server/routes/**/*.ts"]
created: 2026-05-13
---

# IDOR protection: auth + ownership check on every single-resource endpoint

## Rule

Always verify both authentication AND resource ownership for single-resource endpoints. `requireAuth` alone is insufficient — any authenticated user could otherwise access any item.

## Examples

```typescript
// Good: Prevents users from accessing other users' items
app.get(
  "/api/scanned-items/:id",
  requireAuth,
  async (req: Request, res: Response) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid item ID" });
    }

    const item = await storage.getScannedItem(id);

    if (!item || item.userId !== req.userId) {
      return res.status(404).json({ error: "Item not found" });
    }

    res.json(item);
  },
);
```

```typescript
// Bad: IDOR vulnerability - any authenticated user can access any item
app.get(
  "/api/scanned-items/:id",
  requireAuth,
  async (req: Request, res: Response) => {
    const item = await storage.getScannedItem(req.params.id);
    res.json(item); // No ownership check!
  },
);
```

## Why

`requireAuth` confirms _someone_ is logged in. It does not confirm they own the row identified by `:id`. Returning 404 on ownership mismatch (instead of 403) also prevents resource-existence enumeration.

## Exceptions

- Public/shared resources (recipe catalog, isPublic rows) — these need a visibility check, not an ownership check. See the storage-layer IDOR rule for the `or(eq(isPublic, true), eq(authorId, userId))` pattern.

## Related Files

- `docs/rules/security.md` — IDOR rule (binding one-liner)

## See Also

- [Storage-layer defense-in-depth for IDOR](storage-layer-idor-defense-in-depth-2026-05-13.md)
- [Junction table reads via innerJoin through parent](../design-patterns/junction-table-reads-innerjoin-ownership-2026-05-13.md)
- [Lightweight ownership verification for mutations](../design-patterns/lightweight-ownership-verification-mutations-2026-05-13.md)
- [Polymorphic FK IDOR: ownership at every consumer](polymorphic-fk-idor-ownership-every-consumer-2026-05-13.md)
- [Wire optional defense-in-depth parameters at every call site](wire-optional-defense-in-depth-parameters-2026-05-13.md)
