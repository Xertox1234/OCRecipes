---
title: "Deep linking configuration with parseIntOrZero boundary validation"
track: knowledge
category: design-patterns
tags: [react-native, navigation, deep-linking, validation]
module: client
applies_to: ["client/navigation/linking.ts", "client/navigation/__tests__/**"]
created: 2026-05-13
---

# Deep linking configuration with parseIntOrZero boundary validation

## When this applies

Deep linking is configured in `client/navigation/linking.ts` and wired into `NavigationContainer` via the `linking` prop in `App.tsx`. The config maps URL paths to screens through the nested navigator hierarchy.

## Examples

### Supported URLs

| URL pattern                        | Screen               | Stack path                                               |
| ---------------------------------- | -------------------- | -------------------------------------------------------- |
| `ocrecipes://recipe/:recipeId`     | FeaturedRecipeDetail | Root modal (uses community endpoint, works for any user) |
| `ocrecipes://chat/:conversationId` | Chat                 | Main → CoachTab → Chat                                   |
| `ocrecipes://nutrition/:barcode`   | NutritionDetail      | Root modal                                               |
| `ocrecipes://scan`                 | Scan                 | Root modal                                               |

Universal link prefix `https://ocrecipes.app` is also registered (requires server-side AASA file for iOS).

### Adding a new deep link path

1. Add the screen's path mapping to `linking.config.screens` in `client/navigation/linking.ts`, nesting it to match the navigator hierarchy
2. If the param is numeric, use `parseIntOrZero` for the parse function
3. Add a test case in `client/navigation/__tests__/linking.test.ts`

### Boundary validation for URL params

Deep links are untrusted external input. Always use `parseIntOrZero` (not raw `parseInt`) for numeric params — it returns `0` instead of `NaN` for non-numeric strings, which the screen's existing error/not-found UI handles gracefully.

```typescript
// client/navigation/linking.ts
function parseIntOrZero(value: string): number {
  const num = parseInt(value, 10);
  return Number.isNaN(num) ? 0 : num;
}

// Usage in config
FeaturedRecipeDetail: {
  path: "recipe/:recipeId",
  parse: { recipeId: parseIntOrZero },
},
```

## Why

A raw `parseInt` returns `NaN` for non-numeric input. `NaN` propagates downstream (e.g., into a query `?recipeId=NaN`) and produces brittle error states. `0` is a sentinel the screens already handle as "not found," so deep-link garbage degrades into the existing not-found UI rather than crashing.

## Related Files

- `client/navigation/linking.ts` — `parseIntOrZero` + config
- `App.tsx` — `linking` prop on `NavigationContainer`
- `client/navigation/__tests__/linking.test.ts`

## See Also

- [Deep link query param aliases](deep-link-query-param-aliases-2026-05-13.md)
