---
title: "Typed navigation dispatch from AI-generated actions"
track: knowledge
category: design-patterns
tags: [react-native, navigation, typescript, ai, zod, type-narrowing]
module: client
applies_to:
  [
    "client/components/**/*.tsx",
    "client/screens/**/*.tsx",
    "shared/schemas/**/*.ts",
  ]
created: 2026-05-13
---

# Typed navigation dispatch from AI-generated actions

## When this applies

When AI-generated blocks contain navigation actions with dynamically determined screen names (validated by Zod), use a `switch` on literal screen names at the call site. This gives TypeScript proper param type narrowing per screen while keeping the navigation object fully typed. Never cast the navigation object itself to bypass typed navigation.

## Examples

```typescript
// BAD: Casts away the entire navigation type
(
  navigation as {
    navigate: (screen: string, params?: Record<string, unknown>) => void;
  }
).navigate(screen, params);
```

```typescript
// GOOD: Literal screen names give TypeScript per-screen param narrowing
const screen = action.screen as string; // Zod-validated to NAVIGABLE_SCREENS
const params = action.params as Record<string, unknown> | undefined;

switch (screen) {
  case "FeaturedRecipeDetail":
    navigation.navigate(
      "FeaturedRecipeDetail",
      params as RootStackParamList["FeaturedRecipeDetail"],
    );
    break;
  case "RecipeBrowserModal":
    navigation.navigate(
      "RecipeBrowserModal",
      params as RootStackParamList["RecipeBrowserModal"],
    );
    break;
  case "QuickLog":
    navigation.navigate("QuickLog"); // no params needed
    break;
  // ... one case per NAVIGABLE_SCREEN
}
```

## Why

**Key elements:**

1. **Literal screen name in each `case`** — TypeScript narrows the second arg to the correct param type
2. **`params as RootStackParamList[Screen]`** — acceptable boundary cast since Zod validated upstream via `NAVIGABLE_SCREENS` enum
3. **No-param screens omit the second arg** — cleaner than passing `undefined`
4. **Adding a new navigable screen** requires adding it to both the `NAVIGABLE_SCREENS` Zod enum and a new `case` branch

`navigation.navigate(variable, params)` with a `string` variable forces TypeScript to accept any params shape (or none). With a literal `"FeaturedRecipeDetail"`, TypeScript requires `params` to match `{ recipeId: number; ... }`. The switch ensures each screen gets its correct param constraint while the Zod enum upstream ensures only allowlisted screens reach this code.

## Exceptions

When to use:

- Handling AI-generated navigation actions where the screen name comes from validated but dynamic data
- Any context where a Zod-validated screen name must be dispatched through typed React Navigation

When NOT to use:

- Static navigation (hardcoded screen names) — just call `navigation.navigate("Screen", params)` directly
- Config-driven navigation with a `navigateAction()` helper — use the "Config-Driven Screen Rendering" pattern above instead

## Related Files

- `client/components/coach/CoachChat.tsx` — `handleBlockAction` switch dispatch
- `shared/schemas/coach-blocks.ts` — `NAVIGABLE_SCREENS` Zod enum + `navigateActionSchema`
- "Whitelist AI-Generated Navigation Targets" pattern in `docs/legacy-patterns/security.md` — the validation side of this pattern

Origin: Coach Pro code review (2026-04-10) — navigation type cast flagged as Important finding

## See Also

- [Config-driven screen rendering](config-driven-screen-rendering-2026-05-13.md)
