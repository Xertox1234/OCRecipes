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
const MAX_LABEL_CHARS = 80;

const LEAD_ORDER: ShowableReminder["type"][] = [
  "commitment",
  "meal-log",
  "daily-checkin",
];

/**
 * The one reminder the brief leads with, or null. Stale or impossible ones
 * are dropped: a missed-meal reminder once something is logged, and any
 * commitment that may not be spoken — not Coach Pro, or not a confirmed,
 * labelled, active notebook entry (the certainty rule, spec 2026-11-08).
 */
async function pickReminder(
  userId: string,
  items: CoachContextItem[],
  consumedCalories: number,
  coachPro: boolean,
): Promise<ShowableReminder | null> {
  const showable: ShowableReminder[] = [];
  for (const item of items) {
    if (item.type === "commitment" && coachPro) {
      const entry = await storage.getNotebookEntryById(
        item.notebookEntryId,
        userId,
      );
      if (entry?.status !== "active" || !entry.confirmedAt || !entry.label) {
        continue;
      }
      showable.push({
        type: "commitment",
        notebookEntryId: entry.id,
        // Rendered in the coach's voice and saved to history: strip
        // tag-like markup on top of the standard injection filter.
        label: sanitizeContextField(entry.label, MAX_LABEL_CHARS)
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
  const [user, intake, planItems, expiring, dueCommitments, reminders] =
    await Promise.all([
      storage.getUser(userId),
      storage.getDailySummary(userId, now, tz),
      storage.getMealPlanItems(userId, localToday, localToday),
      features.pantryTracking
        ? storage.getExpiringPantryItems(userId, EXPIRING_WITHIN_DAYS)
        : Promise.resolve([]),
      features.coachPro
        ? storage.getCommitmentsWithDueFollowUp(userId)
        : Promise.resolve([]),
      storage.getTodaysPendingReminders(userId, tz, now),
    ]);

  const consumedCalories = intake?.totalCalories ?? 0;
  const consumedProtein = intake?.totalProtein ?? 0;
  const dinner = planItems.find((i) => i.mealType === "dinner");
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
      suggestions: buildCoachSuggestions({
        dueCommitments,
        totalProtein: intake ? consumedProtein : null,
        proteinGoal: user?.dailyProteinGoal ?? null,
        now,
        tz,
      }),
      reminder: await pickReminder(
        userId,
        reminders,
        consumedCalories,
        features.coachPro,
      ),
    },
    form,
  );
}
