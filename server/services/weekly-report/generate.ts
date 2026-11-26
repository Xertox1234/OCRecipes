import { storage } from "../../storage";
import { TIER_FEATURES } from "@shared/types/premium";
import { logger, toError } from "../../lib/logger";
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

/**
 * The two `created-…` results are a report that WAS created, with the
 * template text, because the AI part failed (see WeeklyReportAiFault).
 */
export type GenerateResult =
  | "created"
  | "created-ai-call-failed"
  | "created-bad-reply"
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

  // Everything that can fail runs before the paid AI call, so a failure
  // cannot make a catch-up tick pay for the call again; only the insert
  // itself comes after it (coach audit 2026-11-24, L24). The push setting
  // read here is re-checked at send time (L95).
  const dueAt = await pushDueAt(
    userId,
    now,
    tz,
    settings.pushEnabled,
    facts,
    previous,
  );

  // A scheduled job has no signed-in request, so aiChat's own gate can't see
  // this user: check their AI-sharing permission here. Without it the report
  // still saves, with the template text and no AI call.
  const aiAllowed = await isAiSharingAllowedFor(userId);
  const { content, source, aiFault } = await writeWeeklyReport(facts, {
    aiAllowed,
    userId,
  });
  const row = await storage.insertWeeklyReport(userId, {
    weekStart: week.weekStart,
    weekEnd: week.weekEnd,
    facts,
    content,
    source,
    pushDueAt: dueAt,
  });
  if (!row) return "exists";
  if (aiFault === "call") return "created-ai-call-failed";
  if (aiFault === "reply") return "created-bad-reply";
  return "created";
}

/** A push claim older than this with no send recorded was stranded. */
const STRANDED_CLAIM_MS = 15 * 60_000;

/**
 * Send every push that is due. The delivery claim comes first, so a re-run
 * or a second instance can never send twice; a push that reaches no device
 * hands the report back to the in-app popup.
 *
 * A claim whose process died before the send is recorded is handed to the
 * popup on the next tick (coach audit 2026-11-24, L65). If the process dies
 * after the push but before the send is recorded, the user also gets the
 * popup: a duplicate announcement, accepted over a report never announced.
 */
export async function sendDueWeeklyReportPushes(now: Date): Promise<number> {
  try {
    await storage.releaseStrandedPushClaims(
      new Date(now.getTime() - STRANDED_CLAIM_MS),
    );
  } catch (err) {
    logger.error(
      { err: toError(err) },
      "weekly report: could not release stale push claims",
    );
  }
  const due = await storage.getDuePushes(now);
  let sent = 0;
  for (const p of due) {
    // The user may have turned pushes off after this report was queued.
    if (!p.pushEnabled) {
      try {
        await storage.cancelWeeklyReportPush(p.userId, p.id);
      } catch (err) {
        // Not sent either way; the next tick tries the cancel again.
        logger.error(
          { err: toError(err), userId: p.userId, reportId: p.id },
          "weekly report: could not cancel a push the user turned off",
        );
      }
      continue;
    }
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
        await recordSent(p.userId, p.id);
        continue;
      }
    } catch (err) {
      logger.error(
        { err: toError(err), userId: p.userId, reportId: p.id },
        "weekly report: push failed, handing to the popup",
      );
    }
    await releaseDelivery(p.userId, p.id);
  }
  return sent;
}

/**
 * Record a push that went out. A failure is logged and never stops the loop;
 * the next tick then hands the report to the popup too (see above).
 */
async function recordSent(userId: string, reportId: number) {
  try {
    await storage.markWeeklyReportPushSent(userId, reportId);
  } catch (err) {
    logger.error(
      { err: toError(err), userId, reportId },
      "weekly report: push sent but could not record it; the popup may repeat it",
    );
  }
}

/**
 * Hand an unsent report back to the popup. A failed release must not stop the
 * loop: the remaining pushes still go out this tick. The row it could not
 * release keeps an unsent push claim, which the next tick's stranded-claim
 * sweep (releaseStrandedPushClaims) hands to the popup.
 */
async function releaseDelivery(userId: string, reportId: number) {
  try {
    await storage.releaseWeeklyReportDelivery(userId, reportId);
  } catch (err) {
    logger.error(
      { err: toError(err), userId, reportId },
      "weekly report: could not release the push claim; the next run hands it to the popup",
    );
  }
}
