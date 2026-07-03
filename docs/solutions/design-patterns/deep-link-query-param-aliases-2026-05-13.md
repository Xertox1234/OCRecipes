---
title: Deep link query param aliases via parse + type + screen-fallback layers
track: knowledge
category: design-patterns
module: client
tags: [react-native, navigation, deep-linking, params, type-safety]
applies_to: [client/navigation/**/*.ts, client/screens/**/*.tsx]
created: '2026-05-13'
---

# Deep link query param aliases via parse + type + screen-fallback layers

## When this applies

When a deep link uses a query param (`?type=mealPlan`) that maps to a different navigation param name (`recipeType`), handle it in three layers: parse, type, and screen fallback.

## Examples

### 1. Parse function in linking config — sanitize the query param value

```typescript
// client/navigation/linking.ts
FeaturedRecipeDetail: {
  path: "recipe/:recipeId",
  parse: {
    recipeId: parseIntOrZero,
    type: (value: string) =>
      value === "mealPlan" ? "mealPlan" : "community", // sanitize to known values
  },
},
```

### 2. Add the alias field to the param list — keeps it type-safe

```typescript
// RootStackParamList
FeaturedRecipeDetail: {
  recipeId: number;
  recipeType?: "community" | "mealPlan";
  /** Deep link query param — alias for recipeType */
  type?: "community" | "mealPlan";
};
```

### 3. Screen fallback chain — prefer the canonical name, fall back to the alias

```typescript
const recipeType = route.params.recipeType ?? route.params.type ?? "community";
```

## Why

Deep links are untrusted external input. The parse function rejects garbage values at the boundary. The type declaration keeps TypeScript happy. The fallback chain ensures the screen works whether navigated to programmatically (`recipeType`) or via deep link (`type`).

## Related Files

- `client/navigation/linking.ts` — `type` parser on `FeaturedRecipeDetail`
- `client/navigation/RootStackNavigator.tsx` — `type` field in `FeaturedRecipeDetail` params
- `client/screens/FeaturedRecipeDetailScreen.tsx` — fallback chain

## See Also

- [Deep linking configuration](deep-linking-configuration-2026-05-13.md)
- [Unified modal with type discriminator](unified-modal-with-type-discriminator-2026-05-13.md)
