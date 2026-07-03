---
title: Cross-user product-level queries
track: knowledge
category: design-patterns
module: server
tags: [database, product-level, queries, drizzle, verification]
applies_to: [server/storage/**/*.ts, server/routes/**/*.ts]
created: '2026-05-13'
---

# Cross-user product-level queries

## When this applies

Some data is inherently product-level rather than user-specific. In these cases, queries should intentionally span all users without `userId` filtering or self-exclusion. The key distinction from "Cross-User Aggregation with Self-Exclusion" is that the data describes a product, not user behavior — so any user's contribution benefits everyone equally.

## Examples

```typescript
// server/storage/nutrition.ts — getBarcodeVerification
// Cross-user by design: barcode verification is product-level data, not
// user-specific. If any user has verified a barcode with a label photo,
// all users benefit from that verification.
export async function getBarcodeVerification(
  barcode: string,
): Promise<{ verified: boolean; verifiedAt: Date | null }> {
  const cutoff = new Date(Date.now() - VERIFICATION_WINDOW_MS);

  const [row] = await db
    .select({ scannedAt: scannedItems.scannedAt })
    .from(scannedItems)
    .where(
      and(
        eq(scannedItems.barcode, barcode),
        eq(scannedItems.sourceType, "label"),
        isNull(scannedItems.discardedAt),
        gte(scannedItems.scannedAt, cutoff),
      ),
    )
    .orderBy(desc(scannedItems.scannedAt))
    .limit(1);

  return row
    ? { verified: true, verifiedAt: row.scannedAt }
    : { verified: false, verifiedAt: null };
}
```

## Key elements

1. **No `userId` filter** — the query checks a global property of a product (e.g., "has this barcode been verified?"), not user-specific activity
2. **Explicit documentation** — add a comment explaining why the query is cross-user, since the default expectation is per-user scoping
3. **Still require authentication** — the route uses `requireAuth` to prevent unauthenticated access, even though the query isn't user-scoped

## When to use

Queries that check a global property of a product, resource, or entity — barcode verification, product ratings, content moderation status.

## Exceptions

User-specific data (daily logs, favourites, preferences), or community aggregations where self-exclusion matters (use "Cross-User Aggregation with Self-Exclusion" instead).

## Related Files

- `server/storage/nutrition.ts` — `getBarcodeVerification()`
- `server/routes/nutrition.ts` — `GET /api/nutrition/barcode/:code/verification`

## See Also

- [Cross-user aggregation with self-exclusion](cross-user-aggregation-self-exclusion-2026-05-13.md)
- [Enrichment JSONB on shared records](enrichment-jsonb-on-shared-records-2026-05-13.md)
