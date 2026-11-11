import { z } from "zod";

/**
 * Coach weekly report (spec docs/superpowers/specs/2026-11-10-coach-weekly-report-design.md).
 *
 * FACTS are computed from stored data once, when the report is made, and frozen
 * on the `coach_weekly_reports` row. CONTENT is the sentences Coach wrote (or the
 * template fallback); every number in it must come from the facts. Both schemas
 * are strict so a stray key (fibre, weight) can never ride along.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const count = z.number().int().min(0);

export const FEATURE_TIP_IDS = [
  "barcode",
  "photo",
  "import",
  "pantry",
  "mealPlan",
  "voice",
  "cookbooks",
] as const;
export const featureTipIdSchema = z.enum(FEATURE_TIP_IDS);
export type FeatureTipId = z.infer<typeof featureTipIdSchema>;

export const weeklyDaySchema = z
  .object({
    date: isoDate,
    meals: count,
    calories: z.number().nullable(),
    protein: z.number().nullable(),
    carbs: z.number().nullable(),
    fullyLogged: z.boolean(),
    proteinMet: z.boolean().nullable(),
    caloriesMet: z.boolean().nullable(),
    carbsMet: z.boolean().nullable(),
  })
  .strict();
export type WeeklyDay = z.infer<typeof weeklyDaySchema>;

export const weeklyRecipeTypeSchema = z.enum(["mealPlan", "community"]);
export type WeeklyRecipeType = z.infer<typeof weeklyRecipeTypeSchema>;

export const weeklyRecipeSchema = z
  .object({
    recipeId: z.number().int(),
    recipeType: weeklyRecipeTypeSchema,
    title: z.string(),
    how: z.enum(["saved", "favourited", "imported"]),
    timesLogged: count,
    imageUrl: z.string().nullable(),
  })
  .strict();
export type WeeklyRecipe = z.infer<typeof weeklyRecipeSchema>;

export const weeklyTrendPointSchema = z
  .object({
    weekStart: isoDate,
    proteinDaysMet: count.nullable(),
    daysActive: count,
    recipesAdded: count,
  })
  .strict();
export type WeeklyTrendPoint = z.infer<typeof weeklyTrendPointSchema>;

const nullableGoal = z.number().positive().nullable();

export const weeklyFactsSchema = z
  .object({
    version: z.literal(1),
    weekStart: isoDate,
    weekEnd: isoDate,
    goals: z
      .object({
        calories: nullableGoal,
        protein: nullableGoal,
        carbs: nullableGoal,
      })
      .strict(),
    days: z.array(weeklyDaySchema).length(7),
    daysActive: count.max(7),
    mealsLogged: count,
    recipesAdded: count,
    proteinDaysMet: count.max(7).nullable(),
    caloriesDaysMet: count.max(7).nullable(),
    carbsDaysMet: count.max(7).nullable(),
    celebrate: z.boolean(),
    lowCalorieGuard: z.boolean(),
    safetySignal: z.boolean(),
    recipes: z.array(weeklyRecipeSchema),
    patterns: z.array(z.string()).max(3),
    lastWeek: z
      .object({
        daysActive: count,
        proteinDaysMet: count.nullable(),
        mealsLogged: count,
      })
      .strict()
      .nullable(),
    best: z
      .object({
        proteinDaysMet: count.nullable(),
        daysActive: count,
      })
      .strict()
      .nullable(),
    trend: z.array(weeklyTrendPointSchema).max(5),
    tipIds: z.array(featureTipIdSchema).max(3),
    quiet: z.boolean(),
  })
  .strict();
export type WeeklyFacts = z.infer<typeof weeklyFactsSchema>;

export const weeklyReportContentSchema = z
  .object({
    headline: z.string().min(1).max(120),
    wins: z.array(z.string().min(1).max(240)).max(2),
    watch: z.array(z.string().min(1).max(240)).max(3),
    next: z
      .object({
        text: z.string().min(1).max(240),
        recipeId: z.number().int().nullable(),
        recipeType: weeklyRecipeTypeSchema.nullable(),
      })
      .strict()
      .nullable(),
    fromLogged: z.string().min(1).max(240).nullable(),
    trendLine: z.string().min(1).max(240).nullable(),
  })
  .strict();
export type WeeklyReportContent = z.infer<typeof weeklyReportContentSchema>;

export const weeklyReportSchema = z.object({
  id: z.number().int(),
  weekStart: isoDate,
  weekEnd: isoDate,
  facts: weeklyFactsSchema,
  content: weeklyReportContentSchema,
  seenAt: z.string().nullable(),
  celebrationShownAt: z.string().nullable(),
  deliveredVia: z.enum(["push", "popup"]).nullable(),
});
export type WeeklyReport = z.infer<typeof weeklyReportSchema>;

export const weeklyReportListSchema = z.object({
  reports: z.array(
    z.object({
      id: z.number().int(),
      weekStart: isoDate,
      weekEnd: isoDate,
      headline: z.string(),
      seen: z.boolean(),
    }),
  ),
  trends: z.array(weeklyTrendPointSchema).max(6),
});
export type WeeklyReportList = z.infer<typeof weeklyReportListSchema>;

export const weeklyReportSettingsSchema = z
  .object({
    reportEnabled: z.boolean(),
    pushEnabled: z.boolean(),
  })
  .strict();
export type WeeklyReportSettings = z.infer<typeof weeklyReportSettingsSchema>;

/** Server-side inputs to the facts builder (one week of stored data). */
export interface WeeklyLog {
  loggedAt: Date;
  mealType: string | null;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
}

export interface WeeklyInputs {
  goals: {
    calories: number | null;
    protein: number | null;
    carbs: number | null;
  };
  logs: WeeklyLog[];
  recipes: WeeklyRecipe[];
  /** Earlier reports' facts, newest first, at most 6. */
  previous: WeeklyFacts[];
  coachMessages: string[];
  tipIds: FeatureTipId[];
}
