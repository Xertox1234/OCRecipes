---
title: "Cascade-aware retention ordering"
track: knowledge
category: conventions
tags: [database, postgres, retention, cascade, scripts, ordering]
module: server
applies_to: ["server/scripts/**/*.ts", "server/lib/**/*.ts"]
created: 2026-05-13
---

# Cascade-aware retention ordering

## Rule

When multiple tables have independent retention windows AND a parent→child FK with `ON DELETE CASCADE`, the parent's retention can silently override the child's. Example: `daily_logs.scanned_item_id` cascades from `scanned_items`. If `scanned_items` (365d) purges before `daily_logs` (730d), the 365d window applies to scan-sourced logs.

Run the child purge **first** so its own window applies. Document the resulting effective retention next to the policy constants.

## Examples

```typescript
/**
 * Effective retention for scan-sourced daily_logs is
 * min(SCANNED_ITEMS_RETENTION_DAYS, DAILY_LOGS_RETENTION_DAYS).
 * Recipe-sourced logs (no scanned_item_id) are governed only by
 * DAILY_LOGS_RETENTION_DAYS.
 */
```

## When to use

Any cleanup or anonymisation pipeline that deletes from multiple tables linked by `ON DELETE CASCADE` with differing retention policies.

## Related Files

- `server/scripts/cleanup-retention.ts::runRetentionCleanup`
- `server/lib/retention-policy.ts`

## See Also

- [Batch DELETE with ctid + LIMIT subquery](../design-patterns/batch-delete-with-ctid-limit-subquery-2026-05-13.md)
- [Avoid parameter-limit overflow in NOT IN lists](../design-patterns/avoid-parameter-limit-overflow-not-in-lists-2026-05-13.md)
