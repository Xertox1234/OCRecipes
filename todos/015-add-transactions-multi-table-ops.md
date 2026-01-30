---
title: "Add database transactions for multi-table operations"
status: ready
priority: medium
created: 2026-01-30
updated: 2026-01-30
assignee:
labels: [data-integrity, database, code-review]
---

# Add Database Transactions

## Summary

Multi-table operations in routes.ts lack transactions, allowing partial updates that leave the database in inconsistent states.

## Background

**Location 1:** `server/routes.ts:293-315` (scanned-items POST)

```typescript
const item = await storage.createScannedItem({...});
// If this fails, item exists without daily log
await storage.createDailyLog({...});
```

**Location 2:** `server/routes.ts:180-212` (dietary-profile POST)

```typescript
profile = await storage.createUserProfile({...});
// If this fails, profile exists but onboardingCompleted = false
await storage.updateUser(req.userId!, { onboardingCompleted: true });
```

## Acceptance Criteria

- [ ] Add transaction support to DatabaseStorage class
- [ ] Wrap scanned-items POST in transaction
- [ ] Wrap dietary-profile POST in transaction
- [ ] Handle rollback on failure

## Implementation Notes

```typescript
// storage.ts
async withTransaction<T>(
  fn: (tx: PostgresJsTransaction<...>) => Promise<T>
): Promise<T> {
  return db.transaction(fn);
}

// routes.ts
app.post("/api/scanned-items", requireAuth, async (req, res) => {
  const result = await storage.withTransaction(async (tx) => {
    const item = await tx.insert(scannedItems).values({...}).returning();
    const log = await tx.insert(dailyLogs).values({
      scannedItemId: item[0].id,
      ...
    }).returning();
    return item[0];
  });
  res.status(201).json(result);
});
```

## Dependencies

- None (Drizzle supports transactions)

## Risks

- Slight performance overhead for transaction management
- Need to be careful about transaction scope

## Updates

### 2026-01-30
- Initial creation from code review
