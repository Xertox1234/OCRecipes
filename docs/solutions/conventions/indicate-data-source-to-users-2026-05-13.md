---
title: Indicate data source / format to users when falling back
track: knowledge
category: conventions
module: client
tags: [api, external-api, ux, transparency]
applies_to: [client/screens/**/*.tsx, client/components/**/*.tsx]
created: '2026-05-13'
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

## See Also

- [Per-field fallback for partial data from external APIs](per-field-fallback-partial-data-2026-05-13.md)
