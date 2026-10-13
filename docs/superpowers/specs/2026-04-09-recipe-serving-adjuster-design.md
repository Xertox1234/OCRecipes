# Recipe Serving Adjuster

**Date:** 2026-04-09
**Status:** Approved

## Overview

Add the ability to adjust the serving count on a recipe detail screen and have ingredient quantities automatically scale to match. This is a **client-side, display-only** feature — no backend changes required. Nutrition info is per-serving and remains unchanged.

## User Interaction

- The existing static "2 servings" chip in the meta row becomes an **interactive stepper chip** with `−` / `+` buttons
- Tapping the number opens an **inline text input** (numeric keyboard) for direct entry (e.g., jumping from 2 to 12)
- Haptic feedback on increment/decrement
- When adjusted, the chip gets a subtle accent tint (`withOpacity(theme.link, 0.1)`) to signal modification
- Bounds: min 1, max 99
- Clearing the input and blurring reverts to the current serving count

## Architecture

### New Files

| File                                                     | Purpose                                                                |
| -------------------------------------------------------- | ---------------------------------------------------------------------- |
| `client/lib/serving-scale.ts`                            | Pure utility — fraction parsing, quantity scaling, fraction formatting |
| `client/lib/__tests__/serving-scale.test.ts`             | Unit tests for the scaling math                                        |
| `client/hooks/useServingAdjuster.ts`                     | Hook — holds serving count state, produces scaled ingredients          |
| `client/components/recipe-detail/ServingStepperChip.tsx` | Interactive chip replacing static servings display                     |

### Modified Files

| File                                                        | Change                                                                                                  |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `client/components/recipe-detail/RecipeMetaChips.tsx`       | Accept optional stepper props; render `ServingStepperChip` when interactive, static chip when not       |
| `client/components/RecipeDetailContent.tsx`                 | Wire up `useServingAdjuster`, pass scaled ingredients to list                                           |
| `client/components/recipe-detail/RecipeIngredientsList.tsx` | Add optional `annotation?: string` to `IngredientItem` interface; render as secondary text when present |
| `client/components/recipe-detail/index.ts`                  | Export `ServingStepperChip`                                                                             |

### Data Flow

```
RecipeDetailContent
  └─ useServingAdjuster(originalServings=2, ingredients)
       ├─ servingCount (state: number)
       ├─ scaledIngredients (computed via scaleIngredientQuantity)
       ├─ increment / decrement / setServings
       └─ passes scaledIngredients → RecipeIngredientsList
                  servingCount + callbacks → RecipeMetaChips → ServingStepperChip
```

## Scaling Utility (`client/lib/serving-scale.ts`)

Three pure functions:

### `parseFraction(value: string): number | null`

Parses quantity strings into numbers:

- `"1/2"` → `0.5`
- `"1 1/2"` → `1.5` (mixed fractions)
- `"2"` → `2`
- `"0.5"` → `0.5`
- `"to taste"`, `"a pinch"`, `""` → `null`

### `formatAsFraction(value: number): string`

Converts numbers to cooking-friendly fraction strings:

- `1.5` → `"1 1/2"`
- `0.333` → `"1/3"`
- `0.25` → `"1/4"`
- `4.0` → `"4"`
- Supports: ½, ⅓, ¼, ¾, ⅔, ⅛
- Falls back to 1 decimal place for uncommon values (e.g., `1.67` → `"1.7"`)

### `scaleIngredientQuantity(quantity: string | number | null | undefined, ratio: number): { scaled: string | null; isNumeric: boolean }`

- Uses `parseFraction` to parse, multiplies by `ratio`, formats with `formatAsFraction`
- Numeric: returns `{ scaled: "1 1/2", isNumeric: true }`
- Non-numeric: returns `{ scaled: null, isNumeric: false }`

Ratio calculation: `newServings / originalServings`.

## Hook (`client/hooks/useServingAdjuster.ts`)

### `useServingAdjuster(originalServings: number, ingredients: IngredientItem[])`

Returns:

```ts
{
  servingCount: number;
  scaledIngredients: IngredientItem[];
  isAdjusted: boolean;           // servingCount !== originalServings
  increment: () => void;         // +1, capped at 99
  decrement: () => void;         // -1, min 1
  setServings: (n: number) => void;  // direct input, clamped 1–99
  reset: () => void;             // back to originalServings
}
```

Key behaviors:

- `scaledIngredients` is memoized — recomputes only when `servingCount` or `ingredients` changes
- Each scaled ingredient keeps all original fields (`name`, `unit`, `id`) — only `quantity` is replaced
- Non-numeric quantities get an `annotation` field: `"(adjust for X servings)"`
- Original ingredient objects are not mutated

## UI Components

### `ServingStepperChip`

- Visually matches existing `metaPill` style (same background, border radius, font)
- `−` and `+` buttons flanking the count
- Tapping the count opens inline `TextInput` with numeric keyboard
- On blur/submit: clamp to 1–99 and commit
- When `isAdjusted`: subtle accent tint via `withOpacity(theme.link, 0.1)`
- Haptic feedback on increment/decrement

### `RecipeMetaChips` Changes

New optional props:

- `servingCount?: number`
- `onIncrement?: () => void`
- `onDecrement?: () => void`
- `onSetServings?: (n: number) => void`
- `isAdjusted?: boolean`

When stepper props are provided, renders `ServingStepperChip`. Otherwise renders the original static chip. Full backward compatibility.

### `RecipeIngredientsList` Changes

Ingredient items can optionally carry `annotation?: string`. When present, rendered as small secondary text below the ingredient in `theme.textSecondary`.

## Edge Cases

| Case                                 | Behavior                                      |
| ------------------------------------ | --------------------------------------------- |
| Recipe has no servings (`null`)      | Default to 1, stepper still works             |
| Ingredient quantity is `null`/empty  | Non-numeric — shown unchanged with annotation |
| Quantity is already a number type    | Scale directly, skip parsing                  |
| Serving count typed as 0 or negative | Clamped to 1                                  |
| Serving count typed as 100+          | Clamped to 99                                 |
| User clears text input and blurs     | Revert to current `servingCount`              |

## Testing

### `serving-scale.test.ts` (pure function tests)

- Fraction parsing: `"1/2"` → 0.5, `"1 1/2"` → 1.5, `"2"` → 2, `"0.5"` → 0.5
- Non-numeric detection: `"to taste"`, `"a pinch"`, `""`, `null`, `undefined` → `null`
- Scaling math: ratio 2 turns `"500"` → `"1000"`, `"1/2"` → `"1"`, `"1"` → `"2"`
- Fraction formatting: 0.5 → `"1/2"`, 1.5 → `"1 1/2"`, 0.333 → `"1/3"`, 4.0 → `"4"`
- Edge cases: ratio 1 (no change), ratio 0.5 (halving), small quantities like `"1/8"` scaled down

### Hook tests

- Increment/decrement clamp at 1 and 99
- `isAdjusted` toggles correctly
- Non-numeric ingredients get annotation, numeric ones get scaled quantities
- Original ingredient objects are not mutated

## Out of Scope

- Backend/schema changes
- Persisting adjusted serving count
- Scaling nutrition info (already per-serving)
- Animations on quantity change (can be added later)
