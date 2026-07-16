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

The example above assumes the source (Open Food Facts) explicitly provides a per-serving nutrient (`energy-kcal_serving`) — "do we have real serving data" collapses to "did the API give us one." That is **not** true of every architecture that displays a scaled value. `server/services/barcode-lookup.ts` never reads `energy-kcal_serving`; it always computes the displayed value by parsing a serving-size string (`serving_size`/`quantity`) into a weight and scaling `per100g` by it. For that shape, "do we have real serving data" means "did we parse a real, un-corrected serving weight," not "did the API supply an explicit per-serving field" — see `hasServingData = servingGrams !== null && servingGrams > 0` in that file, mirrored by `client/lib/serving-size-utils.ts`'s parsed-serving-weight branch (`isServingDataTrusted: !wasCorrected` when a real `servingGrams` was parsed and used — distinct from that same file's explicit-per-serving-nutriment branch). Pick the analog that matches how the per-serving value was actually derived, not the literal formula above, if the two diverge.

Whichever architecture you're in, the flag must be derived **only** from that "do we have real data" question — never from an unrelated secondary signal (e.g. whether a cross-validation source happened to agree on the calorie count). See `../logic-errors/trust-flag-conflated-with-secondary-source-agreement-2026-07-16.md` for a case where that coupling slipped in and mislabeled correct data.

## Related Files

- `client/screens/NutritionDetailScreen.tsx` — UI gating (`isPer100g ? " (per 100g)" : ""`, the "Check package" banner)
- `client/hooks/useNutritionLookup.ts` — `isPer100g` derivation from the server/OFF-fallback response
- `server/services/barcode-lookup.ts` — server-side `isServingDataTrusted` source, parsed-serving-weight variant (see Exceptions above)
- `client/lib/serving-size-utils.ts` — client OFF-fallback path, explicit-per-serving-nutriment variant matching this doc's original example

## See Also

- [Per-field fallback for partial data from external APIs](per-field-fallback-partial-data-2026-05-13.md)
- [A data-trust/label flag derived from secondary-source agreement instead of the provenance signal it's meant to represent](../logic-errors/trust-flag-conflated-with-secondary-source-agreement-2026-07-16.md)
