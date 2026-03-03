---
title: "Merge toggle ownership check into transaction to halve latency"
status: backlog
priority: low
created: 2026-02-27
updated: 2026-02-27
assignee:
labels: [performance, server, api, pr-10-review]
---

# Merge Toggle Ownership Check Into Transaction

## Summary

The favourite toggle route makes 2 sequential DB round-trips: one to verify ownership (`getScannedItem`), then one for the toggle transaction. Merging both into a single transaction halves endpoint latency.

## Background

**File:** `server/routes/nutrition.ts` (favourite toggle route)

```typescript
// Round-trip 1: Full row fetch just to check userId
const item = await storage.getScannedItem(id);
if (!item || item.userId !== req.userId) { return 404; }

// Round-trip 2: Transaction (SELECT + INSERT/DELETE)
const isFavourited = await storage.toggleFavouriteScannedItem(id, req.userId!);
```

The same pattern applies to the soft-delete route. Both do a separate ownership check before the actual operation.

## Acceptance Criteria

- [ ] Favourite toggle uses a single transaction for ownership check + toggle
- [ ] Soft delete uses a single transaction for ownership check + update
- [ ] Route handlers updated to handle `null` return (item not found)
- [ ] ~50% latency reduction on toggle endpoint
- [ ] All existing tests pass

## Implementation Notes

See todo #013 for the combined implementation. This todo tracks the performance aspect specifically.

## Dependencies

- Related to todo #013 (TOCTOU fix)

## Updates

### 2026-02-27
- Created from PR #10 code review (found by performance-oracle)
