import { storage } from "../../storage";
import { TIER_FEATURES } from "@shared/types/premium";
import { logger } from "../../lib/logger";
import { isAiSharingAllowedFor } from "../../lib/ai-sharing-gate";
import { civilDateString, civilDateToInstant } from "../../lib/civil-date";
import { notify } from "../notifications/notify";
import { buildWeeklyFacts } from "./facts";
import { pickTips } from "./feature-tips";
import { hasSafetySignal } from "./text-guard";
import { addCivilDays, reportWeekFor } from "./week-window";
import { writeWeeklyReport } from "./writer";
import type { WeeklyFacts } from "@shared/schemas/coach-weekly-report";

/**
 * One user's weekly report, end to end, and the push that announces it
 * (spec docs/superpowers/specs/2026-11-10-coach-weekly-report-design.md).
 * Coach Pro gates generation only; reading old reports is never gated.
 */

/** Local hour a push held overnight goes out the next morning. */
const DEFERRED_PUSH_LOCAL_HOUR = 9;
/** Pushes pause after this many reports in a row with nothing logged. */
const EMPTY_WEEKS_BEFORE_PAUSE = 3;
const HOUR_MS = 3_600_000;

export type GenerateResult =
  | "created"
  | "exists"
  | "skipped-not-pro"
  | "skipped-disabled";

function pushesPaused(facts: WeeklyFacts, previous: WeeklyFacts[]): boolean {
  const recent = [facts, ...previous].slice(0, EMPTY_WEEKS_BEFORE_PAUSE);
  return (
    recent.length === EMPTY_WEEKS_BEFORE_PAUSE &&
    recent.every((f) => f.mealsLogged === 0)
  );
}

async function pushDueAt(
  userId: string,
  now: Date,
  tz: string,
  pushEnabled: boolean,
  facts: WeeklyFacts,
  previous: WeeklyFacts[],
): Promise<Date | null> {
  if (!pushEnabled || pushesPaused(facts, previous)) return null;
  const today = civilDateString(now, tz);
  const sentToday = await storage.hasReminderSince(
    userId,
    "commitment",
    civilDateToInstant(today, tz),
  );
  if (!sentToday) return now;
  const tomorrow = civilDateToInstant(addCivilDays(today, 1), tz);
  return new Date(tomorrow.getTime() + DEFERRED_PUSH_LOCAL_HOUR * HOUR_MS);
}

export async function generateWeeklyReportForUser(
  userId: string,
  now: Date,
  tz: string,
): Promise<GenerateResult> {
  const tier = await storage.getEffectiveTierForUser(userId);
  if (!TIER_FEATURES[tier].coachPro) return "skipped-not-pro";
  const settings = await storage.getWeeklyReportSettings(userId);
  if (!settings.reportEnabled) return "skipped-disabled";

  const week = reportWeekFor(now, tz);
  if (await storage.weeklyReportExists(userId, week.weekStart)) return "exists";

  const [inputs, previous, usage] = await Promise.all([
    storage.getWeeklyReportInputs(userId, week.fromUtc, week.toUtc),
    storage.getRecentWeeklyFacts(userId, week.weekStart, 6),
    storage.getFeatureUsage(userId),
  ]);

  const draft = buildWeeklyFacts(
    { ...inputs, previous, tipIds: [] },
    week,
    tz,
    hasSafetySignal(inputs.coachMessages),
  );
  const facts: WeeklyFacts = {
    ...draft,
    tipIds: pickTips(
      usage,
      previous.map((p) => p.tipIds),
      draft.quiet,
    ),
  };

  // A scheduled job has no signed-in request, so aiChat's own gate can't see
  // this user: check their AI-sharing permission here. Without it the report
  // still saves, with the template text and no AI call.
  const aiAllowed = await isAiSharingAllowedFor(userId);
  const { content, source } = await writeWeeklyReport(facts, { aiAllowed });
  const row = await storage.insertWeeklyReport(userId, {
    weekStart: week.weekStart,
    weekEnd: week.weekEnd,
    facts,
    content,
    source,
    pushDueAt: await pushDueAt(
      userId,
      now,
      tz,
      settings.pushEnabled,
      facts,
      previous,
    ),
  });
  return row ? "created" : "exists";
}

/**
 * Send every push that is due. The delivery claim comes first, so a re-run
 * or a second instance can never send twice; a push that reaches no device
 * hands the report back to the in-app popup.
 */
export async function sendDueWeeklyReportPushes(now: Date): Promise<number> {
  const due = await storage.getDuePushes(now);
  let sent = 0;
  for (const p of due) {
    if (!(await storage.claimWeeklyReportDelivery(p.userId, p.id, "push"))) {
      continue;
    }
    try {
      const { pushDelivered } = await notify(p.userId, "weekly-report", {
        title: "Your week is ready",
        body: p.headline,
        data: {
          url: `ocrecipes://weekly-report/${p.id}`,
          type: "weekly-report",
          reportId: p.id,
        },
      });
      if (pushDelivered) {
        sent++;
      } else {
        await storage.releaseWeeklyReportDelivery(p.userId, p.id);
      }
    } catch (err) {
      logger.error(
        { err, userId: p.userId, reportId: p.id },
        "weekly report: push failed, handing to the popup",
      );
      await storage.releaseWeeklyReportDelivery(p.userId, p.id);
    }
  }
  return sent;
}
