---
title: 'PII stripping in API response serialization (allowlist, not blocklist)'
track: knowledge
category: design-patterns
module: server
tags: [security, pii, api-response, serialization, allowlist]
applies_to: [server/routes/**/*.ts]
created: '2026-05-13'
---

# PII stripping in API response serialization (allowlist, not blocklist)

## When this applies

When internal data models contain user-identifying fields (e.g., `scannedByUserId`, `scannedAt`) that must never be exposed to external API consumers, create explicit serializer functions that allowlist fields rather than blocklist.

## Examples

```typescript
// ✅ GOOD — allowlist approach: only include what's safe
function serializePaidResponse(row: BarcodeVerification): PaidProductResponse {
  const rawFrontLabel = row.frontLabelData as FrontLabelData | null;
  const frontLabel = rawFrontLabel
    ? {
        brand: rawFrontLabel.brand, // ← explicitly picked
        productName: rawFrontLabel.productName,
        netWeight: rawFrontLabel.netWeight,
        claims: rawFrontLabel.claims,
        // scannedByUserId: OMITTED
        // scannedAt: OMITTED
      }
    : null;
  return { ...data, frontLabel };
}

// ❌ BAD — blocklist approach: easy to miss new fields
const { scannedByUserId, scannedAt, ...safeFrontLabel } = rawFrontLabel;
```

## Test pattern

Assert the full JSON response body does NOT contain PII field names:

```typescript
const json = JSON.stringify(res.body);
expect(json).not.toContain("scannedByUserId");
expect(json).not.toContain("scannedAt");
```

## Why

Allowlisting is safer than blocklisting. If a new PII field is added to the schema later, the blocklist approach silently leaks it. The allowlist approach requires explicitly adding each new field, defaulting to omission. Allowlists fail safe; denylists fail open.

## Related Files

- `server/routes/public-api.ts` — `serializePaidResponse()`, `serializeFreeResponse()`

## See Also

- [Mass-assignment protection: whitelist updatable fields](../conventions/mass-assignment-protection-whitelist-fields-2026-05-13.md)
- [Exclude sensitive columns from default queries](../conventions/exclude-sensitive-columns-default-queries-2026-05-13.md)
