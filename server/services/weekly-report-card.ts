// server/services/weekly-report-card.ts
/**
 * The weekly report card (Coach roadmap A3). The model names a report by the
 * id get_weekly_reports gave it and never writes its numbers; this reads the
 * report for the user, so the card only ever shows what the report stored.
 * A report is frozen once made, so the card's copy never goes stale.
 */
import { storage } from "../storage";
import type { WeeklyReportBlock } from "@shared/schemas/coach-blocks";

/**
 * The card for one report. Throws when it is missing (not this user's,
 * never there, or a stored row that no longer parses), so no card shows a
 * week the user cannot open.
 */
export async function buildWeeklyReportBlock(
  reportId: number,
  userId: string,
): Promise<WeeklyReportBlock> {
  const report = await storage.getWeeklyReport(userId, reportId);
  if (!report) {
    throw new Error(`report ${reportId} is not one of this user's reports`);
  }
  return {
    type: "weekly_report",
    reportId: report.id,
    weekStart: report.weekStart,
    weekEnd: report.weekEnd,
    headline: report.content.headline,
    daysActive: report.facts.daysActive,
    mealsLogged: report.facts.mealsLogged,
    // A week the report guarded (very low intake, or a sign of distress)
    // shows no goal count to be proud of, as the report itself cheers
    // nothing that week.
    proteinDaysMet:
      report.facts.safetySignal || report.facts.lowCalorieGuard
        ? null
        : report.facts.proteinDaysMet,
  };
}
