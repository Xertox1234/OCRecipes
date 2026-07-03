---
title: Validate LLM tool call date parameters with a calendar check
track: knowledge
category: conventions
module: server
tags: [api, ai, openai, tool-calls, validation, dates, zod]
applies_to: [server/services/**/*.ts]
created: '2026-05-13'
---

# Validate LLM tool call date parameters with a calendar check

## Rule

When LLM tool calls include date parameters, a regex check for `YYYY-MM-DD` format is not sufficient. Use a Zod schema that chains a format regex with a `.refine()` that calls `isValidCalendarDate()`. Also cap any date ranges to a maximum day count to prevent prompt-injected over-fetch.

## Why

LLMs will sometimes generate syntactically valid but calendar-invalid dates like `"2026-02-30"` (February has no 30th) or `"2026-13-01"` (no month 13). These pass a format regex but fail at the DB layer with cryptic errors. Models learn date patterns from text and produce plausible-looking values — they have no mechanism to verify the calendar.

## Examples

```typescript
import { isValidCalendarDate } from "../utils/date-validation";

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
  .refine(isValidCalendarDate, "Must be a real calendar date");

// Tool schema
const getMealPlanSchema = z
  .object({
    startDate: isoDateSchema.optional(),
    endDate: isoDateSchema.optional(),
  })
  .refine((data) => {
    if (data.startDate && data.endDate) {
      return (
        daysBetween(data.startDate, data.endDate) <= MAX_MEAL_PLAN_RANGE_DAYS
      );
    }
    return true;
  }, `Date range must not exceed ${MAX_MEAL_PLAN_RANGE_DAYS} days`);
```

## Compact output pattern

Tool calls that retrieve DB rows should return a compact projection rather than full ORM shapes. Full rows are expensive in tokens and expose more data than the LLM needs.

```typescript
// Compact projection for LLM consumption
function compactMealPlanItems(items: MealPlanItem[]) {
  return items.map((item) => ({
    id: item.id,
    plannedDate: item.plannedDate,
    mealType: item.mealType,
    servings: item.servings,
    recipe: item.recipe
      ? {
          id: item.recipe.id,
          title: item.recipe.title,
          caloriesPerServing: item.recipe.caloriesPerServing,
        }
      : null,
  }));
}
```

## Related Files

- `server/services/coach-tools.ts` — `isoDateSchema`, `MAX_MEAL_PLAN_RANGE_DAYS`, `compactMealPlanItems`
- `server/utils/date-validation.ts` — `isValidCalendarDate()`

## Origin

2026-04-29 audit M1.
