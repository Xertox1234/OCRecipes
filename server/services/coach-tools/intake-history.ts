import { z } from "zod";
import {
  addCivilDays,
  civilDateString,
  civilDateToInstant,
} from "../../lib/civil-date";
import { storage } from "../../storage";
import { inRange, isLowIntake, proteinMet } from "../weekly-report/facts";
import { defineTool, isoDateSchema, type CoachToolEntry } from "./types";

/** As many days as the heatmap chart can show. */
export const MAX_HISTORY_DAYS = 35;
const DEFAULT_HISTORY_DAYS = 7;
/** The low-intake guard always judges at least the last week, like the weekly report. */
const GUARD_DAYS = 7;

const getIntakeHistorySchema = z.object({
  days: z.number().int().min(1).max(MAX_HISTORY_DAYS).optional(),
  endDate: isoDateSchema.optional(),
});

/** A goal the user set: an unset or zero goal is no goal. */
function goal(value: number | null | undefined): number | null {
  return value && value > 0 ? value : null;
}

/**
 * Several days of the user's intake in one call (deferred from Coach roadmap
 * T4): the trend charts, sparkline and heatmap, need every point, and
 * get_daily_log_details reads one day per call. Each day is the same read as
 * Home's daily summary, in the user's zone, one at a time so a call holds one
 * database connection. Goal flags use the weekly report's rules, and so does
 * the guard: a stretch that is mostly under the safe line hands back no
 * numbers to chart or praise.
 */
const getIntakeHistoryTool = defineTool({
  name: "get_intake_history",
  available: (opts) => !!opts.writeCards,
  definition: () => ({
    type: "function",
    function: {
      name: "get_intake_history",
      description: `Read the user's daily totals for a run of days in one call, oldest first: for each day the date, whether anything was logged and how many items, calories, and grams of protein, carbs and fat, and whether the protein goal (at least 90% of it) and the calorie goal (within 10% either way) were met. At most ${MAX_HISTORY_DAYS} days, ending today unless endDate names an earlier day; a later endDate reads up to today, so label the chart with the returned from and to. Use it for a trend chart (sparkline or heatmap) or a question about the last few weeks, not one call per day. A day not logged has no numbers and is not a day without food: never say the user ate nothing, leave it out of a sparkline or any average, and in a heatmap show it as 0 with no hit. A day with only an item or two may be partly logged, so never call it low intake. A goal flag is blank with no goal or nothing logged, and not met can also mean some foods had no value recorded, so never scold a missed day. If sensitive is true, logged intake looks mostly very low, which can also mean thinly logged days: the numbers are left out, so draw no chart of intake, praise nothing about it, never mention calories, never say or imply the user ate too little, and be warm and brief.`,
      parameters: {
        type: "object",
        properties: {
          days: {
            type: "integer",
            minimum: 1,
            maximum: MAX_HISTORY_DAYS,
            description: `How many days to read, ending on endDate (default ${DEFAULT_HISTORY_DAYS}).`,
          },
          endDate: {
            type: "string",
            description:
              "The last day to read, ISO YYYY-MM-DD. Omit it for today; resolve any other day against the current date in USER CONTEXT.",
          },
        },
        required: [],
      },
    },
  }),
  argsSchema: getIntakeHistorySchema,
  run: async (args, { userId, tz }) => {
    const today = civilDateString(new Date(), tz);
    // ISO dates compare as strings: a day after today reads up to today.
    const to = args.endDate && args.endDate < today ? args.endDate : today;
    const count = args.days ?? DEFAULT_HISTORY_DAYS;
    const from = addCivilDays(to, -(count - 1));

    const user = await storage.getUser(userId);
    const goals = {
      calories: goal(user?.dailyCalorieGoal),
      protein: goal(user?.dailyProteinGoal),
      carbs: goal(user?.dailyCarbsGoal),
      fat: goal(user?.dailyFatGoal),
    };

    const read: {
      date: string;
      meals: number;
      calories: number;
      protein: number;
      carbs: number;
      fat: number;
    }[] = [];
    // The guard always sees at least the last week up to `to`, so a short
    // window cannot pick a normal day out of a low stretch.
    const readCount = Math.max(count, GUARD_DAYS);
    const readFrom = addCivilDays(to, -(readCount - 1));
    for (let i = 0; i < readCount; i++) {
      const date = addCivilDays(readFrom, i);
      const s = await storage.getDailySummary(
        userId,
        civilDateToInstant(date, tz),
        tz,
      );
      read.push({
        date,
        meals: Number(s.itemCount) || 0,
        calories: Math.round(Number(s.totalCalories) || 0),
        protein: Math.round(Number(s.totalProtein) || 0),
        carbs: Math.round(Number(s.totalCarbs) || 0),
        fat: Math.round(Number(s.totalFat) || 0),
      });
    }

    const sensitive =
      isLowIntake(read, goals.calories) ||
      isLowIntake(read.slice(-GUARD_DAYS), goals.calories);
    const shownDays = read.slice(-count);
    return {
      from,
      to,
      goals: sensitive
        ? { calories: null, protein: null, carbs: null, fat: null }
        : goals,
      sensitive,
      days: shownDays.map((d) => {
        const logged = d.meals > 0;
        const show = !sensitive;
        // A day with nothing logged has no numbers: zero would chart as a
        // day without food.
        const shown = show && logged;
        return {
          date: d.date,
          logged,
          items: d.meals,
          calories: shown ? d.calories : null,
          protein: shown ? d.protein : null,
          carbs: shown ? d.carbs : null,
          fat: shown ? d.fat : null,
          proteinMet: shown ? proteinMet(d.protein, goals.protein) : null,
          caloriesMet: shown ? inRange(d.calories, goals.calories) : null,
        };
      }),
    };
  },
});

export const INTAKE_HISTORY_TOOLS: CoachToolEntry[] = [getIntakeHistoryTool];
