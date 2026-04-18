// shared/schemas/meal-plan.ts
//
// Canonical schema + type for a single day in a meal plan. Owned by the
// Plan domain so downstream consumers (Coach, navigation params) depend
// on Plan, not the other way around.
import { z } from "zod";

export const mealPlanDaySchema = z.object({
  label: z.string(),
  meals: z.array(
    z.object({
      type: z.enum(["breakfast", "lunch", "dinner", "snack"]),
      title: z.string(),
      calories: z.number(),
      protein: z.number(),
    }),
  ),
  totals: z.object({
    calories: z.number(),
    protein: z.number(),
  }),
});

export type MealPlanDay = z.infer<typeof mealPlanDaySchema>;
