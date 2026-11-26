// server/services/week-progress.ts
/**
 * The week progress card (Coach roadmap T3, living blocks). The model asks
 * for one with `{ "type": "week_progress" }` and never writes its numbers:
 * the server stores the user's calendar date for today, the last of the
 * seven days, with each day's calories as they are now for the app to show
 * until its own reads of those days arrive. The app then keeps it current.
 */
import { storage } from "../storage";
import {
  addCivilDays,
  civilDateString,
  civilDateToInstant,
} from "../lib/civil-date";
import { DEFAULT_NUTRITION_GOALS } from "@shared/constants/nutrition";
import type { WeekProgressBlock } from "@shared/schemas/coach-blocks";

/** A total as a number: the database's sums can arrive as strings. */
function total(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export async function buildWeekProgressBlock(ctx: {
  userId: string;
  tz: string;
  now?: Date;
  user: { dailyCalorieGoal: number | null };
}): Promise<WeekProgressBlock> {
  const endDate = civilDateString(ctx.now ?? new Date(), ctx.tz);
  // Oldest first. One read per day, the same read Home and the app's card
  // make, so the snapshot and the live card add a day up the same way.
  const days = [6, 5, 4, 3, 2, 1, 0].map((back) =>
    addCivilDays(endDate, -back),
  );
  const summaries = await Promise.all(
    days.map((date) =>
      storage.getDailySummary(
        ctx.userId,
        civilDateToInstant(date, ctx.tz),
        ctx.tz,
      ),
    ),
  );
  return {
    type: "week_progress",
    endDate,
    snapshot: {
      calories: summaries.map((s) => total(s.totalCalories)),
      // An unset calorie goal is the app's default, as the day card reads it.
      calorieGoal:
        ctx.user.dailyCalorieGoal || DEFAULT_NUTRITION_GOALS.calories,
    },
  };
}
