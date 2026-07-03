---
title: Enrichment JSONB on shared records
track: knowledge
category: design-patterns
module: server
tags: [database, jsonb, drizzle, shared-records, enrichment, zod]
applies_to: [server/storage/**/*.ts, shared/schema.ts, shared/types/**/*.ts]
created: '2026-05-13'
---

# Enrichment JSONB on shared records

## When this applies

When adding optional enrichment data to shared (product-level) records that doesn't affect the primary data model's integrity.

## Examples

```typescript
// Schema: nullable JSONB column, default null
frontLabelData: (jsonb("front_label_data"),
  // Storage: overwrite with latest scan
  await tx
    .update(barcodeVerifications)
    .set({
      frontLabelData: data as unknown as Record<string, unknown>,
      updatedAt: new Date(),
    })
    .where(eq(barcodeVerifications.barcode, barcode)));
```

## Key principles

- **Separate from consensus/verification** — enrichment data doesn't gate or affect the primary data model
- **Latest-wins overwrite** — no audit trail needed, any authorized user can contribute
- **Track contributor in JSONB** — include `scannedByUserId` and `scannedAt` inside the JSONB since the parent row has no `userId` column (it's product-level)
- **Validate with Zod before storing** — `frontLabelDataSchema.safeParse(data)` before write
- **Always validate on read** — JSONB shape can't be trusted; use `safeParse` when reading back
- **Wrap multi-table writes in transaction** — if enrichment also marks a per-user tracking boolean, use `db.transaction()` for atomicity

## Related Files

- `server/storage/verification.ts` — `confirmFrontLabelData()` for transactional enrichment storage
- `shared/types/front-label.ts` — `frontLabelDataSchema` Zod schema for JSONB shape

## See Also

- [Cross-user product-level queries](cross-user-product-level-queries-2026-05-13.md)
- [Typed JSONB columns with .$type<>() and sql default](typed-jsonb-columns-type-sql-default-2026-05-13.md)
- [JSONB metadata versioning](jsonb-metadata-versioning-2026-05-13.md)
