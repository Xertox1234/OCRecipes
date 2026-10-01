---
title: Typed navigation dispatch from AI-generated actions
track: knowledge
category: design-patterns
module: client
tags: [react-native, navigation, typescript, ai, zod, type-narrowing]
applies_to: [client/components/**/*.tsx, client/screens/**/*.tsx, shared/schemas/**/*.ts]
created: '2026-05-13'
last_updated: '2026-09-24'
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

## Exhaustiveness guard (required when switching over a discriminated union)

**Refinement added 2026-09-24.**

When this switch-on-literal-screen-names pattern is applied to dispatch a typed `navigate` call over a discriminated union, ALWAYS add an exhaustiveness-guard `default` arm — not just the per-screen switch cases themselves. The guard is the `never`-typed const plus `throw`; it turns a future unhandled union member into a compile error instead of a silent runtime no-op.

This was discovered while updating `client/screens/ScanScreen.tsx`'s `onSmartPhotoConfirm` handler. A new switch over `ClassificationRoute` (six members: `PhotoAnalysis`, `LabelAnalysis`, `MenuScanResult`, `CookSessionCapture`, `ReceiptCapture`, `NutritionDetail`) replaced an untyped `navigation.navigate` cast. Two independent code reviewers flagged the same WARNING on the new switch: it had no `default`/exhaustiveness arm, so a future new `ClassificationRoute` member would compile clean and silently no-op (no navigation, no error surfaced) instead of failing loudly.

The same file already established the fix on a sibling switch over `action.kind` nine lines away:

```typescript
default: {
  // a silent no-op is exactly the bug this change fixes
  const _exhaustive: never = action;
  throw new Error(`Unhandled action kind: ${action.kind}`);
}
```

The fix applied to the new switch uses the same pattern:

```typescript
default: {
  const _exhaustive: never = action.route;
  throw new Error(`Unhandled ClassificationRoute member: ${action.route}`);
}
```

This is easy to omit because the switch still type-checks and lints clean without the `default` arm — no ESLint `switch-exhaustiveness-check` rule exists in this repo. Every switch over a discriminated union that dispatches typed navigation must include this guard.

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
- `client/screens/ScanScreen.tsx` — `onSmartPhotoConfirm` switch over `ClassificationRoute` with exhaustiveness-guard default
- "Whitelist AI-Generated Navigation Targets" pattern in `docs/legacy-patterns/security.md` — the validation side of this pattern

Origin: Coach Pro code review (2026-04-10) — navigation type cast flagged as Important finding

## See Also

- [Config-driven screen rendering](config-driven-screen-rendering-2026-05-13.md)