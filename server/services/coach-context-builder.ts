import { storage } from "../storage";
import { civilHourInTz } from "../lib/civil-date";
import { sanitizeContextField } from "../lib/ai-safety";
import { getBlocksSystemPrompt } from "./coach-blocks";
import {
  formatNotebookLine,
  truncateNotebookToBudget,
  sortNotebookEntriesByPriority,
  DEFAULT_NOTEBOOK_MAX_CHARS,
} from "./notebook-budget";
import { isRecipeFinderEnabled } from "./recipe-finder";
import type { CoachContext } from "./nutrition-coach";
import type { PremiumFeatures } from "@shared/types/premium";
import type { MeasurementUnit } from "@shared/lib/units";
import type { CoachNotebookEntry, DailyLog, UserProfile } from "@shared/schema";

export interface CoachContextData {
  goals: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  } | null;
  todayIntake: {
    totalCalories: number;
    totalProtein: number;
    totalCarbs: number;
    totalFat: number;
    itemCount: number;
  };
  dietaryProfile: {
    dietType: string | null;
    allergies: string[];
    dislikes: string[] | null;
  } | null;
  notebook: {
    id: number;
    type: string;
    content: string;
    status: string;
    followUpDate: Date | null;
    updatedAt: Date | null;
  }[];
  dueCommitments: CoachNotebookEntry[];
  suggestions: string[];
}

/**
 * Aggregate all data needed to render the coach context panel.
 *
 * Pattern: mirrors `getProfileWidgets` in `services/profile-hub.ts` —
 * parallel storage calls, derived logic, and response-shape construction
 * all live in the service so the route handler is a thin wrapper.
 */
export async function buildCoachContext(
  userId: string,
  _features: PremiumFeatures,
  tz: string = "UTC",
): Promise<CoachContextData> {
  // One `now` for the whole function: the day-summary fetch and the
  // time-of-day chip below could otherwise straddle an hour or day boundary
  // and describe two different moments.
  const now = new Date();
  const [profile, todayIntake, notebookEntries, dueCommitments, user] =
    await Promise.all([
      storage.getUserProfile(userId),
      storage.getDailySummary(userId, now, tz),
      storage.getActiveNotebookEntries(userId),
      storage.getCommitmentsWithDueFollowUp(userId),
      storage.getUser(userId),
    ]);

  // Generate contextual suggestion chips
  const suggestions: string[] = [];
  if (dueCommitments.length > 0) {
    suggestions.push(`How did "${dueCommitments[0].content}" go?`);
  }
  // No fabricated default: the system prompt forbids the model from citing
  // numbers absent from USER CONTEXT, so a chip may only quote a real goal.
  if (todayIntake && user?.dailyProteinGoal != null) {
    const proteinLeft = user.dailyProteinGoal - (todayIntake.totalProtein ?? 0);
    if (proteinLeft > 30) {
      suggestions.push(`I need ${Math.round(proteinLeft)}g more protein today`);
    }
  }
  // The USER's hour, not the server's. `new Date().getHours()` reads the host
  // zone — UTC on Railway — so an LA user at 8am PDT (15:00 UTC) matched
  // neither branch and got no chip, while at 6pm PDT (01:00 UTC the next day)
  // they were offered breakfast ideas. `tz` has been a parameter of this
  // function all along.
  //
  // `hourCycle: "h23"` is stated explicitly rather than left to the `hour12`
  // shorthand. Measured on Node 24.9.0 / ICU 77.1, `hour12: false` and
  // `hourCycle: "h23"` both render midnight as "00"; the variant that renders
  // it "24" is `hourCycle: "h24"`, which older ECMA-402 mapped `hour12: false`
  // onto. Being explicit removes the dependence on which mapping the runtime
  // implements.
  //
  // The consequence if an hour of 24 ever did leak through is NOT "no chip":
  // `24 >= 17` is true, so midnight would serve the EVENING chip. The midnight
  // test pins that.
  const hour = civilHourInTz(now, tz);
  if (hour < 11) {
    suggestions.push("Quick breakfast ideas");
  } else if (hour >= 17) {
    suggestions.push("How was my day?");
  }
  if (suggestions.length < 3) {
    suggestions.push("What should I eat next?");
  }

  return {
    goals: user?.dailyCalorieGoal
      ? {
          calories: user.dailyCalorieGoal,
          protein: user.dailyProteinGoal || 0,
          carbs: user.dailyCarbsGoal || 0,
          fat: user.dailyFatGoal || 0,
        }
      : null,
    todayIntake,
    dietaryProfile: profile
      ? {
          dietType: profile.dietType,
          allergies: (profile.allergies || [])
            .map((a) => a.name)
            .filter(Boolean),
          dislikes: profile.foodDislikes,
        }
      : null,
    notebook: notebookEntries.map((e) => ({
      id: e.id,
      type: e.type,
      content: e.content,
      status: e.status,
      followUpDate: e.followUpDate,
      updatedAt: e.updatedAt,
    })),
    dueCommitments,
    suggestions: suggestions.slice(0, 5),
  };
}

/** Users-table fields the coach chat reads (the route passes these in). */
export interface CoachChatUser {
  dailyCalorieGoal: number | null;
  dailyProteinGoal: number | null;
  dailyCarbsGoal: number | null;
  dailyFatGoal: number | null;
  /** Drizzle decimal column — arrives as a string, kg. */
  weight: string | null;
  /** Drizzle decimal column — arrives as a string, kg. */
  goalWeight: string | null;
  measurementUnit: MeasurementUnit;
}

/**
 * Derive a short meal-pattern summary from 7 days of daily logs.
 *
 * Exported for unit testing — all inputs are pure values, no storage calls.
 *
 * Detection logic (based on `loggedAt` hour in the USER's timezone — the
 * server runs UTC, so server-local hours would misclassify every window for
 * most users):
 *  - Breakfast window: 05:00–10:59
 *  - Lunch window:     11:00–14:59
 *  - Dinner window:    15:00–20:59
 *  - Late-night:       21:00–04:59 (hour >= 21 || hour < 5)
 *
 * A meal is considered "skipped" on a given day when there are zero log entries
 * in its window AND at least one entry exists on that day (i.e. the user was
 * actively logging, they just didn't eat in that window). Days with zero total
 * entries are excluded — we can't distinguish "skipped" from "didn't log".
 *
 * Returns `null` when the dataset has fewer than 3 active-logging days (not
 * enough signal). The caller is responsible for pre-filtering logs to the
 * desired time window (e.g. last 7 days) before passing them in.
 */
export function buildMealPatternSummary(
  logs: Pick<DailyLog, "loggedAt">[],
  tz: string = "UTC",
  windowDays: number = 7,
): string | null {
  if (logs.length === 0) return null;

  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });

  // Group log hours by calendar day (YYYY-MM-DD in the user's timezone)
  const byDay = new Map<string, number[]>();
  for (const log of logs) {
    const parts = fmt.formatToParts(new Date(log.loggedAt));
    const part = (type: Intl.DateTimeFormatPartTypes): string =>
      parts.find((p) => p.type === type)?.value ?? "";
    const key = `${part("year")}-${part("month")}-${part("day")}`;
    const hour = Number(part("hour"));
    const existing = byDay.get(key);
    if (existing) {
      existing.push(hour);
    } else {
      byDay.set(key, [hour]);
    }
  }

  // Only consider days with at least one log entry
  const activeDays = Array.from(byDay.values());
  if (activeDays.length < 3) return null;

  const totalDays = activeDays.length;

  const inBreakfast = (h: number) => h >= 5 && h < 11;
  const inLunch = (h: number) => h >= 11 && h < 15;
  const inDinner = (h: number) => h >= 15 && h < 21;
  const isLateNight = (h: number) => h >= 21 || h < 5;

  let skippedBreakfast = 0;
  let skippedLunch = 0;
  let skippedDinner = 0;
  let lateNightDays = 0;

  for (const hours of activeDays) {
    if (!hours.some(inBreakfast)) skippedBreakfast++;
    if (!hours.some(inLunch)) skippedLunch++;
    if (!hours.some(inDinner)) skippedDinner++;
    if (hours.some(isLateNight)) lateNightDays++;
  }

  const patterns: string[] = [];

  // Positive signal first: a near-complete logging streak is free praise
  // material — the summary previously only ever surfaced negatives.
  // Clamp the numerator: the caller's rolling [now-7d, now) instant window
  // spans parts of EIGHT calendar dates in the user's tz (unless "now" is
  // exactly midnight), so an unclamped count would render "8/7 days".
  if (totalDays >= windowDays - 2) {
    patterns.push(
      `logged food on ${Math.min(totalDays, windowDays)}/${windowDays} days`,
    );
  }

  // Only surface patterns that are notable (skipped on majority of days)
  const majorityThreshold = Math.ceil(totalDays / 2);
  if (skippedBreakfast >= majorityThreshold) {
    patterns.push(`breakfast skipped ${skippedBreakfast}/${totalDays} days`);
  }
  if (skippedLunch >= majorityThreshold) {
    patterns.push(`lunch skipped ${skippedLunch}/${totalDays} days`);
  }
  if (skippedDinner >= majorityThreshold) {
    patterns.push(`dinner skipped ${skippedDinner}/${totalDays} days`);
  }
  if (lateNightDays >= majorityThreshold) {
    patterns.push(`late-night eating on ${lateNightDays}/${totalDays} days`);
  }

  if (patterns.length === 0) return null;
  return patterns.join("; ");
}

/** Parse a Drizzle decimal string into a finite positive kg value, else undefined. */
function parseDecimalKg(value: string | null): number | undefined {
  if (value == null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Assemble CoachContext.aboutUser from the profile row and users-table fields
 * (M40: user-authored strings sanitized here, at the context boundary).
 * Returns undefined when nothing carries signal so the prompt renders no
 * ABOUT THIS USER section: null fields, empty cuisine list, and the
 * householdSize column default of 1 are all "unset".
 */
function buildAboutUser(
  profile: UserProfile | undefined,
  user: CoachChatUser,
): CoachContext["aboutUser"] {
  const aboutUser: NonNullable<CoachContext["aboutUser"]> = {};
  if (profile?.primaryGoal) {
    aboutUser.primaryGoal = sanitizeContextField(profile.primaryGoal, 100);
  }
  if (profile?.activityLevel) {
    aboutUser.activityLevel = sanitizeContextField(profile.activityLevel, 100);
  }
  if (profile?.cookingSkillLevel) {
    aboutUser.cookingSkillLevel = sanitizeContextField(
      profile.cookingSkillLevel,
      100,
    );
  }
  if (profile?.cookingTimeAvailable) {
    aboutUser.cookingTimeAvailable = sanitizeContextField(
      profile.cookingTimeAvailable,
      100,
    );
  }
  const cuisines = (profile?.cuisinePreferences ?? [])
    .filter(Boolean)
    .map((c) => sanitizeContextField(c, 100));
  if (cuisines.length > 0) {
    aboutUser.cuisinePreferences = cuisines;
  }
  if (profile?.householdSize != null && profile.householdSize > 1) {
    aboutUser.householdSize = profile.householdSize;
  }
  const weightKg = parseDecimalKg(user.weight);
  const goalWeightKg = parseDecimalKg(user.goalWeight);
  if (weightKg !== undefined) aboutUser.weightKg = weightKg;
  if (goalWeightKg !== undefined) aboutUser.goalWeightKg = goalWeightKg;
  if (weightKg !== undefined || goalWeightKg !== undefined) {
    aboutUser.measurementUnit = user.measurementUnit;
  }
  return Object.keys(aboutUser).length > 0 ? aboutUser : undefined;
}

/**
 * Pure assembly of the `CoachContext` for one chat turn from already-fetched
 * rows. Extracted verbatim from `handleCoachChat`; `isCoachPro` gates the
 * Pro-only sections (rows for those are empty for the free tier).
 */
export function assembleCoachContext(a: {
  isCoachPro: boolean;
  user: CoachChatUser;
  tz: string;
  screenContext?: string;
  profile: UserProfile | undefined;
  dailySummary: Awaited<ReturnType<typeof storage.getDailySummary>>;
  recentLogsForPatterns: Pick<DailyLog, "loggedAt">[];
  notebookEntries: Awaited<ReturnType<typeof storage.getActiveNotebookEntries>>;
  dueCommitments: Awaited<
    ReturnType<typeof storage.getCommitmentsWithDueFollowUp>
  >;
  frequentFoods: Awaited<ReturnType<typeof storage.getMostEatenFoods>>;
}): CoachContext {
  const {
    isCoachPro,
    user,
    tz,
    screenContext,
    profile,
    dailySummary,
    recentLogsForPatterns,
    notebookEntries,
    dueCommitments,
    frequentFoods,
  } = a;
  const context: CoachContext = {
    goals: user.dailyCalorieGoal
      ? {
          calories: user.dailyCalorieGoal,
          protein: user.dailyProteinGoal || 0,
          carbs: user.dailyCarbsGoal || 0,
          fat: user.dailyFatGoal || 0,
        }
      : null,
    todayIntake: {
      calories: Number(dailySummary.totalCalories),
      protein: Number(dailySummary.totalProtein),
      carbs: Number(dailySummary.totalCarbs),
      fat: Number(dailySummary.totalFat),
    },
    dietaryProfile: {
      dietType: profile?.dietType || null,
      // Sanitize at the context boundary (M40 — 2026-04-18) so both the prompt
      // builder and any future consumers see clean values. Severity is
      // enum-validated (jsonb defense-in-depth) — bogus values are dropped.
      allergies: (profile?.allergies || [])
        .filter((a) => a?.name)
        .map((a) => ({
          name: sanitizeContextField(a.name, 100),
          ...(a.severity === "mild" ||
          a.severity === "moderate" ||
          a.severity === "severe"
            ? { severity: a.severity }
            : {}),
        })),
      dislikes: ((profile?.foodDislikes as string[]) || []).map((d) =>
        sanitizeContextField(d, 100),
      ),
    },
    screenContext,
  };

  // Both tiers: profile personalization signal (omitted when nothing is set).
  const aboutUser = buildAboutUser(profile, user);
  if (aboutUser) {
    context.aboutUser = aboutUser;
  }

  // ── Coach Pro: meal pattern summary ────────────────
  if (isCoachPro && recentLogsForPatterns.length > 0) {
    const mealPatternSummary = buildMealPatternSummary(
      recentLogsForPatterns,
      tz,
    );
    if (mealPatternSummary) {
      context.mealPatternSummary = mealPatternSummary;
    }
  }

  // ── Coach Pro: frequent foods (30-day aggregate) ────
  if (isCoachPro && frequentFoods.length > 0) {
    context.frequentFoodsSummary = frequentFoods
      .map((f) => `${sanitizeContextField(f.name, 100)} (${f.timesLogged}×)`)
      .join(", ");
  }

  // ── Coach Pro: due-commitment follow-ups ────────────
  if (isCoachPro && dueCommitments.length > 0) {
    // At most 3 — the prompt asks the model to check in on ONE; more rows
    // only cost tokens. Same sanitize + fence treatment as notebook entries.
    const dueLines = dueCommitments.slice(0, 3).map((e) =>
      formatNotebookLine({
        type: e.type,
        content: sanitizeContextField(e.content, 500),
        updatedAt: e.updatedAt,
      }),
    );
    context.dueCommitmentsSummary = dueLines.join("\n");
  }

  // ── Coach Pro: inject notebook context ──────────────
  if (isCoachPro) {
    // Always provide blocks formatting instructions for Pro responses
    context.blocksPrompt = getBlocksSystemPrompt(isRecipeFinderEnabled());

    // notebookEntries fetched in parallel above (audit 2026-05-10, H4)
    if (notebookEntries.length > 0) {
      // Include updatedAt so the budget formatter can attach recency labels
      // (recent/this week/this month/older), helping the model weight newer
      // entries more prominently in its reasoning.
      const sanitized = notebookEntries.map((e) => ({
        type: e.type,
        content: sanitizeContextField(e.content, 500),
        updatedAt: e.updatedAt,
      }));
      // Durable personalization first so the truncation budget can't evict a
      // months-old preference in favor of a burst of recent insights.
      const joined = truncateNotebookToBudget(
        sortNotebookEntriesByPriority(sanitized),
        DEFAULT_NOTEBOOK_MAX_CHARS,
      );
      if (joined.length > 0) {
        context.notebookSummary = joined;
      }
      // If truncation produces empty string, omit notebook section entirely
    }
    // When no entries exist, notebookSummary stays unset — no confusing preamble
  }

  return context;
}
