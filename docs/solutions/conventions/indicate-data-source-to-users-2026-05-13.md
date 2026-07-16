---
title: Indicate data source / format to users when falling back
track: knowledge
category: conventions
module: client
tags: [api, external-api, ux, transparency]
applies_to: [client/screens/**/*.tsx, client/components/**/*.tsx]
created: '2026-05-13'
last_updated: '2026-07-16'
---

# Indicate data source / format to users when falling back

## Rule

When falling back to different data formats (e.g., per-100g nutrition values instead of per-serving), inform users in the UI what they're seeing.

## Why

Users compare displayed values against package labels. When the displayed value is per-100g but the label is per-serving, the mismatch reads as a bug or as bad data. A visible label removes the ambiguity.

## Examples

```typescript
const hasServingData = nutriments["energy-kcal_serving"] !== undefined;
setIsPer100g(!hasServingData);

// In UI:
<ThemedText>
  Calories{isPer100g ? " (per 100g)" : ""}
</ThemedText>

{isPer100g && (
  <InfoMessage>
    Values shown per 100g. Check package for actual serving size.
  </InfoMessage>
)}
```

## Exceptions

The example above assumes the source (Open Food Facts) explicitly provides a per-serving nutrient (`energy-kcal_serving`) — "do we have real serving data" collapses to "did the API give us one." That is **not** true of every architecture that displays a scaled value. `server/services/barcode-lookup.ts` never reads `energy-kcal_serving`; it always computes the displayed value by parsing a serving-size string into a weight and scaling `per100g` by it. For that shape, "do we have real serving data" means "did we parse a real, un-corrected serving weight" — see `hasServingData = servingGrams !== null && servingGrams > 0` in that file. Pick the analog that matches how the per-serving value was actually derived, not the literal formula above, if the two diverge.

**Which raw field counts as "real" matters, not just whether parsing succeeded.** Open Food Facts exposes both `serving_size` (a labeled per-serving amount, e.g. "355 ml") and `quantity` (the whole package's net weight, e.g. "500 g") — these are semantically different fields, and only the former is real per-serving provenance. `server/services/barcode-lookup.ts` originally built its parsed string from `serving_size || quantity`, so a package's `quantity` that happened to parse under the plausibility-correction thresholds could be scaled and labeled trusted, even though it was never a per-serving value. As of P3-2026-07-16, `barcode-lookup.ts` reads `serving_size` only — `quantity` is excluded entirely, not merely down-weighted, because it is the wrong field semantically rather than a weaker version of the right one. `client/lib/serving-size-utils.ts`'s OFF-fallback path (used only when the server is unreachable) had the identical `serving_size || quantity` conflation on this axis — it was **not** already correct here (its "already correct" status referred only to the separate cross-validation-coupling bug below); as of P3-2026-07-16 it also reads `serving_size` only, matching the server-side fix.

Whichever architecture you're in, the flag must be derived **only** from that "do we have real data" question — never from an unrelated secondary signal (e.g. whether a cross-validation source happened to agree on the calorie count). See `../logic-errors/trust-flag-conflated-with-secondary-source-agreement-2026-07-16.md` for a case where that coupling slipped in and mislabeled correct data.

## Related Files

- `client/screens/NutritionDetailScreen.tsx` — UI gating (`isPer100g ? " (per 100g)" : ""`, the "Check package" banner)
- `client/hooks/useNutritionLookup.ts` — `isPer100g` derivation from the server/OFF-fallback response
- `server/services/barcode-lookup.ts` — server-side `isServingDataTrusted` source, parsed-serving-weight variant, `serving_size`-only as of P3-2026-07-16 (see Exceptions above)
- `client/lib/serving-size-utils.ts` — client OFF-fallback path; explicit-per-serving-nutriment variant matches this doc's original example; parsed-serving-weight branch is `serving_size`-only as of P3-2026-07-16 (see Exceptions above)

## See Also

- [Per-field fallback for partial data from external APIs](per-field-fallback-partial-data-2026-05-13.md)
- [A data-trust/label flag derived from secondary-source agreement instead of the provenance signal it's meant to represent](../logic-errors/trust-flag-conflated-with-secondary-source-agreement-2026-07-16.md)
