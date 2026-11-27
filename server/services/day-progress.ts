// server/services/day-progress.ts
/**
 * The day progress card (Coach roadmap T3, living blocks). The model asks for
 * one by naming the day, `{ "type": "day_progress", "day": "today" }`, and
 * never writes its numbers: the server turns the day into the user's calendar
 * date and stores that, with the numbers as they are now for the app to show
 * until its own read of that day arrives. The app then keeps it current.
 */
import { storage } from "../storage";
import {
  addCivilDays,
  civilDateString,
  civilDateToInstant,
} from "../lib/civil-date";
import { DEFAULT_NUTRITION_GOALS } from "@shared/constants/nutrition";
import type { DayProgressBlock, DayTotals } from "@shared/schemas/coach-blocks";
import type { DayProgressDay } from "./day-progress-request";

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

/**
 * An unset calorie goal is the app's default, as /api/daily-budget reads it.
 * An unset macro goal is 0, "no goal", as the Coach's own context and the
 * day detail screen read it: the card never shows a target the user didn't
 * pick.
 */
function goalsOf(user: DayProgressGoals): DayTotals {
  return {
    calories: user.dailyCalorieGoal || DEFAULT_NUTRITION_GOALS.calories,
    protein: user.dailyProteinGoal || 0,
    carbs: user.dailyCarbsGoal || 0,
    fat: user.dailyFatGoal || 0,
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
