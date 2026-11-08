/**
 * Gathers the day's data for the Coach opening brief and renders it with the
 * shared fixed-wording templates — no model call. Used by
 * `GET /api/coach/brief` and, on a coach conversation's first send, to save
 * the same brief as the conversation's first assistant message. The client
 * never supplies brief text (spec: 2026-11-08-coach-opening-brief-design).
 */
import { storage } from "../storage";
import { civilDateString, civilHourInTz } from "../lib/civil-date";
import { sanitizeContextField } from "../lib/ai-safety";
import { buildCoachSuggestions } from "./coach-context-builder";
import { selectTopInsights } from "@shared/lib/coach-stats";
import {
  renderOpeningBrief,
  type BriefForm,
  type RenderedBrief,
  type ShowableReminder,
} from "@shared/lib/opening-brief";
import type { PremiumFeatures } from "@shared/types/premium";
import type { CoachContextItem } from "@shared/types/reminders";

const EXPIRING_WITHIN_DAYS = 1;
const MAX_EXPIRING = 3;
const MAX_COMMITMENT_CHARS = 200;

const LEAD_ORDER: ShowableReminder["type"][] = [
  "commitment",
  "meal-log",
  "daily-checkin",
];

/**
 * The one reminder the brief leads with, or null. Stale or impossible ones
 * are dropped: a missed-meal reminder once something is logged, and a
 * commitment for a free user (their notebook is never written).
 */
function pickReminder(
  items: CoachContextItem[],
  consumedCalories: number,
  coachPro: boolean,
): ShowableReminder | null {
  const showable: ShowableReminder[] = [];
  for (const item of items) {
    if (item.type === "commitment" && coachPro) {
      showable.push({
        type: "commitment",
        notebookEntryId: item.notebookEntryId,
        // Saved later in the coach's own voice, so strip tag-like markup on
        // top of the standard injection filter.
        content: sanitizeContextField(item.content, MAX_COMMITMENT_CHARS)
          .replace(/[<>]/g, "")
          .trim(),
      });
    } else if (item.type === "meal-log" && Math.round(consumedCalories) <= 0) {
      showable.push({ type: "meal-log" });
    } else if (item.type === "daily-checkin") {
      showable.push({ type: "daily-checkin" });
    }
  }
  for (const type of LEAD_ORDER) {
    const found = showable.find((r) => r.type === type);
    if (found) return found;
  }
  return null;
}

export async function buildCoachBrief(
  userId: string,
  features: PremiumFeatures,
  tz: string,
  form: BriefForm,
  now: Date = new Date(),
): Promise<RenderedBrief> {
  const localToday = civilDateString(now, tz);
  const [
    user,
    intake,
    planItems,
    expiring,
    notebook,
    dueCommitments,
    reminders,
  ] = await Promise.all([
    storage.getUser(userId),
    storage.getDailySummary(userId, now, tz),
    storage.getMealPlanItems(userId, localToday, localToday),
    features.pantryTracking
      ? storage.getExpiringPantryItems(userId, EXPIRING_WITHIN_DAYS)
      : Promise.resolve([]),
    features.coachPro
      ? storage.getActiveNotebookEntries(userId)
      : Promise.resolve([]),
    features.coachPro
      ? storage.getCommitmentsWithDueFollowUp(userId)
      : Promise.resolve([]),
    storage.getTodaysPendingReminders(userId, tz, now),
  ]);

  const consumedCalories = intake?.totalCalories ?? 0;
  const consumedProtein = intake?.totalProtein ?? 0;
  const dinner = planItems.find((i) => i.mealType === "dinner");
  const [tip] = selectTopInsights(notebook, 1);
  const firstName = user?.displayName?.trim().split(/\s+/)[0] || null;

  return renderOpeningBrief(
    {
      localHour: civilHourInTz(now, tz),
      name: firstName,
      consumedCalories,
      calorieGoal: user?.dailyCalorieGoal || null,
      consumedProtein,
      proteinGoal: user?.dailyProteinGoal ?? null,
      tonightPlan: dinner?.recipe?.title ?? null,
      expiringPantry: expiring.slice(0, MAX_EXPIRING).map((p) => p.name),
      topTip: tip ? tip.content : null,
      suggestions: buildCoachSuggestions({
        dueCommitments,
        totalProtein: intake ? consumedProtein : null,
        proteinGoal: user?.dailyProteinGoal ?? null,
        now,
        tz,
      }),
      reminder: pickReminder(reminders, consumedCalories, features.coachPro),
    },
    form,
  );
}
