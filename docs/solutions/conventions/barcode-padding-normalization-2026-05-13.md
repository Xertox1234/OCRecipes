---
title: Barcode padding normalization — try all plausible variants
track: knowledge
category: conventions
module: server
tags: [api, barcode, normalization, lookup, upc, ean]
applies_to: [server/services/**/*.ts]
created: '2026-05-13'
---

# Barcode padding normalization — try all plausible variants

## Rule

Barcodes can be encoded in different formats (UPC-A 12-digit, EAN-13 13-digit). When looking up a barcode against an external or internal database, generate all plausible variants (zero-padding, check-digit completions) and try each one.

## Why

A scanner may return `"60731142363"` (11 digits) while the database stores `"060731142363"` (12-digit UPC-A with leading zero). Without normalization, valid products appear as "not found." Normalizing at the lookup boundary avoids polluting the DB with multiple stored variants of the same code.

## Examples

```typescript
function barcodeVariants(raw: string): string[] {
  const variants = new Set<string>();
  variants.add(raw);

  // Zero-pad to 12 or 13 digits
  const padded12 = raw.padStart(12, "0");
  const padded13 = raw.padStart(13, "0");
  variants.add(padded12);
  variants.add(padded13);

  // Compute check digits for UPC-A and EAN-13
  variants.add(computeUPCA(raw));
  variants.add(computeEAN13(raw));

  return [...variants].filter((v) => /^\d{8,14}$/.test(v));
}
```

## Related Files

- `server/services/nutrition-lookup.ts` — `barcodeVariants()`, `computeUPCA()`, `computeEAN13()`

## See Also

- [Multi-source nutrition lookup chain](../design-patterns/multi-source-nutrition-lookup-chain-2026-05-13.md)
