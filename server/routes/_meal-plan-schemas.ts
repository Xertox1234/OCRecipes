import { z } from "zod";
import { ErrorCode } from "@shared/constants/error-codes";
import { isValidCalendarDate } from "../utils/date-validation";
import { numericStringField, nullableNumericStringField } from "./_schemas";

// Zod schemas for meal plan endpoints
export const createMealPlanRecipeSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().max(2000).optional().nullable(),
  cuisine: z.string().max(100).optional().nullable(),
  difficulty: z.string().max(50).optional().nullable(),
  servings: z.number().int().min(1).max(50).optional(),
  prepTimeMinutes: z.number().int().min(0).max(1440).optional().nullable(),
  cookTimeMinutes: z.number().int().min(0).max(1440).optional().nullable(),
  imageUrl: z
    .string()
    .url()
    .max(2000)
    .refine(
      (url) => /^https?:\/\//.test(url),
      "Only http:// or https:// URLs allowed",
    )
    .optional()
    .nullable(),
  instructions: z.array(z.string()).max(100).optional(),
  dietTags: z.array(z.string().max(50)).max(20).optional(),
  caloriesPerServing: nullableNumericStringField,
  proteinPerServing: nullableNumericStringField,
  carbsPerServing: nullableNumericStringField,
  fatPerServing: nullableNumericStringField,
  sourceType: z
    .enum(["user_created", "quick_entry", "ai_suggestion", "photo_import"])
    .optional()
    .default("user_created"),
  ingredients: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        quantity: nullableNumericStringField,
        unit: z.string().max(50).optional().nullable(),
        category: z.string().max(50).optional(),
      }),
    )
    .optional(),
  sourceCommunityRecipeId: z.number().int().positive().optional().nullable(),
});

export const addMealPlanItemSchema = z.object({
  recipeId: z.number().int().positive().optional().nullable(),
  scannedItemId: z.number().int().positive().optional().nullable(),
  // Inline recipe: created together with the plan item in one transaction.
  recipe: createMealPlanRecipeSchema
    .omit({ sourceCommunityRecipeId: true })
    .optional(),
  plannedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]),
  servings: numericStringField,
});

/** YYYY-MM-DD format guard for meal-plan date-range query params. */
const MEAL_PLAN_DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;
/** Maximum span (inclusive of both endpoints) allowed for a meal-plan query. */
const MEAL_PLAN_MAX_RANGE_DAYS = 90;

/**
 * Validate a meal-plan date range (GET /api/meal-plan `start`/`end` params).
 *
 * Exported so the validator is unit-tested against the real implementation
 * instead of a tautological re-implementation in the test body. The route
 * handler maps a failure to `sendError(res, 400, error, code)` — `code` is
 * `undefined` for the missing/format case (no machine code, preserving the
 * original response shape) and `ErrorCode.VALIDATION_ERROR` for the calendar,
 * ordering, and range-length cases.
 */
export function validateMealPlanDateRange(
  start: string | undefined,
  end: string | undefined,
):
  | { valid: true; start: string; end: string }
  | { valid: false; error: string; code?: ErrorCode } {
  if (
    !start ||
    !end ||
    !MEAL_PLAN_DATE_FORMAT.test(start) ||
    !MEAL_PLAN_DATE_FORMAT.test(end)
  ) {
    return {
      valid: false,
      error: "start and end query parameters required (YYYY-MM-DD)",
    };
  }

  if (!isValidCalendarDate(start) || !isValidCalendarDate(end)) {
    return {
      valid: false,
      error: "Invalid calendar date",
      code: ErrorCode.VALIDATION_ERROR,
    };
  }

  if (start > end) {
    return {
      valid: false,
      error: "start must be on or before end",
      code: ErrorCode.VALIDATION_ERROR,
    };
  }

  const startMs = new Date(start + "T00:00:00Z").getTime();
  const endMs = new Date(end + "T00:00:00Z").getTime();
  const diffDays = (endMs - startMs) / (1000 * 60 * 60 * 24);
  if (diffDays > MEAL_PLAN_MAX_RANGE_DAYS) {
    return {
      valid: false,
      error: "Date range must not exceed 90 days",
      code: ErrorCode.VALIDATION_ERROR,
    };
  }

  return { valid: true, start, end };
}
