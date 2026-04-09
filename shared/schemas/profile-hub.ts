import { z } from "zod";

// ---------------------------------------------------------------------------
// Widget data (calorie budget, fasting status, weight trend)
// ---------------------------------------------------------------------------

const dailyBudgetSchema = z.object({
  calorieGoal: z.number(),
  foodCalories: z.number(),
  remaining: z.number(),
});

const fastingScheduleSchema = z.object({
  id: z.number(),
  userId: z.string(),
  protocol: z.string(),
  fastingHours: z.number(),
  eatingHours: z.number(),
  eatingWindowStart: z.string().nullable(),
  eatingWindowEnd: z.string().nullable(),
  isActive: z.boolean(),
  notifyEatingWindow: z.boolean(),
  notifyMilestones: z.boolean(),
  notifyCheckIns: z.boolean(),
});

const fastingLogSchema = z.object({
  id: z.number(),
  userId: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  targetDurationHours: z.number(),
  actualDurationMinutes: z.number().nullable(),
  completed: z.boolean().nullable(),
  note: z.string().nullable(),
});

const latestWeightSchema = z.object({
  value: z.number(),
  unit: z.string(),
  date: z.string(),
});

export const profileWidgetsSchema = z.object({
  dailyBudget: dailyBudgetSchema,
  fasting: z.object({
    schedule: fastingScheduleSchema.nullable(),
    currentFast: fastingLogSchema.nullable(),
  }),
  latestWeight: latestWeightSchema.nullable(),
});

export type ProfileWidgetsResponse = z.infer<typeof profileWidgetsSchema>;

// ---------------------------------------------------------------------------
// Library counts (cookbook, saved items, scan history, etc.)
// ---------------------------------------------------------------------------

export const libraryCountsSchema = z.object({
  cookbooks: z.number(),
  savedItems: z.number(),
  scanHistory: z.number(),
  groceryLists: z.number(),
  pantryItems: z.number(),
  featuredRecipes: z.number(),
  favouriteRecipes: z.number(),
});

export type LibraryCountsResponse = z.infer<typeof libraryCountsSchema>;
