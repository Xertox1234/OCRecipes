// shared/constants/meal-types.ts
import { z } from "zod";

/**
 * The meal types, one list for the coach and finder schemas and the coach
 * tools' JSON definitions (coach chat audit 2026-11-24, L129). Meal-plan and
 * recipe schemas outside the coach area still carry their own literals.
 */
export const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;
export type MealTypeId = (typeof MEAL_TYPES)[number];

export const mealTypeSchema = z.enum(MEAL_TYPES);
