// server/services/day-progress.ts
/**
 * The day progress card (Coach roadmap T3, living blocks). The model asks for
 * one by naming the day, `{ "type": "day_progress", "day": "today" }`, and
 * never writes its numbers: the server turns the day into the user's calendar
 * date and stores that, with the numbers as they are now for the app to show
 * until its own read of that day arrives. The app then keeps it current.
 */
import { z } from "zod";
import { storage } from "../storage";
import {
  addCivilDays,
  civilDateString,
  civilDateToInstant,
} from "../lib/civil-date";
import { DEFAULT_NUTRITION_GOALS } from "@shared/constants/nutrition";
import type { DayProgressBlock, DayTotals } from "@shared/schemas/coach-blocks";

export type DayProgressDay = "today" | "yesterday";

// Not strict: a key the model added (a title, made-up numbers) is dropped,
// not a reason to lose the card.
const dayProgressRequestSchema = z.object({
  type: z.literal("day_progress"),
  day: z.enum(["today", "yesterday"]),
});

/** The day a model-authored day_progress block asks for, if it is one. */
export function readDayProgressRequest(
  raw: unknown,
): DayProgressDay | undefined {
  const parsed = dayProgressRequestSchema.safeParse(raw);
  return parsed.success ? parsed.data.day : undefined;
}

export interface DayProgressGoals {
  dailyCalorieGoal: number | null;
  dailyProteinGoal: number | null;
  dailyCarbsGoal: number | null;
  dailyFatGoal: number | null;
}

/** A total as a number: the database's sums can arrive as strings. */
function total(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** An unset goal (null or 0) is the default the app shows for it. */
function goalsOf(user: DayProgressGoals): DayTotals {
  return {
    calories: user.dailyCalorieGoal || DEFAULT_NUTRITION_GOALS.calories,
    protein: user.dailyProteinGoal || DEFAULT_NUTRITION_GOALS.protein,
    carbs: user.dailyCarbsGoal || DEFAULT_NUTRITION_GOALS.carbs,
    fat: user.dailyFatGoal || DEFAULT_NUTRITION_GOALS.fat,
  };
}

export async function buildDayProgressBlock(
  day: DayProgressDay,
  ctx: { userId: string; tz: string; now?: Date; user: DayProgressGoals },
): Promise<DayProgressBlock> {
  const today = civilDateString(ctx.now ?? new Date(), ctx.tz);
  const date = day === "today" ? today : addCivilDays(today, -1);
  const summary = await storage.getDailySummary(
    ctx.userId,
    civilDateToInstant(date, ctx.tz),
    ctx.tz,
  );
  return {
    type: "day_progress",
    date,
    snapshot: {
      totals: {
        calories: total(summary.totalCalories),
        protein: total(summary.totalProtein),
        carbs: total(summary.totalCarbs),
        fat: total(summary.totalFat),
      },
      goals: goalsOf(ctx.user),
    },
  };
}
