import { z } from "zod";
import { sanitizeUserInput } from "../../lib/ai-safety";
import { storage } from "../../storage";
import { defineTool, type CoachToolEntry } from "./types";

/** As many weeks as the reports screen's trend shows. */
const REPORTS_LISTED = 6;

const getWeeklyReportsSchema = z.object({
  reportId: z.number().int().positive().max(2147483647).optional(),
});

/**
 * The user's weekly reports (Coach roadmap A3), newest first: what the
 * weekly_report card names by id, and one report's counts and sentences so
 * the Coach can talk about the week. The headline and sentences were written
 * by an earlier model call from the user's own data, so they are sanitized
 * like every other stored text a tool hands back; the account id is left out.
 */
const getWeeklyReportsTool = defineTool({
  name: "get_weekly_reports",
  available: (opts) => !!opts.writeCards,
  definition: () => ({
    type: "function",
    function: {
      name: "get_weekly_reports",
      description:
        "List the user's weekly reports, newest first (at most 6): each one's id, week (Sunday to Saturday) and headline. Also returns one report in detail: the days logged, meals logged, the days the protein and calorie goals were met (blank when there was no goal, or on a sensitive week), what went well, what to watch, fromLogged (the report's note on what was logged), celebrate (true only for a week the report itself praised) and sensitiveWeek (true when the report found very low intake or a sign of distress: be gentle, praise nothing about intake, and never mention calories). The newest is read unless reportId names another from the list.",
      parameters: {
        type: "object",
        properties: {
          reportId: {
            type: "integer",
            minimum: 1,
            description:
              "The id of the report to read in detail, from an earlier result of this tool.",
          },
        },
        required: [],
      },
    },
  }),
  argsSchema: getWeeklyReportsSchema,
  run: async (args, { userId }) => {
    const rows = await storage.listWeeklyReports(userId, REPORTS_LISTED);
    const wanted = args.reportId ?? rows[0]?.id;
    const report =
      wanted === undefined
        ? null
        : await storage.getWeeklyReport(userId, wanted);
    // A week the report guarded (intake mostly under the safe line, or a
    // sign of distress): the report itself hides calories and cheers
    // nothing, so the Coach gets no goal counts to praise either.
    const sensitive =
      !!report && (report.facts.safetySignal || report.facts.lowCalorieGuard);
    return {
      reports: rows.map((r) => ({
        id: r.id,
        weekStart: r.weekStart,
        weekEnd: r.weekEnd,
        headline: sanitizeUserInput(r.headline),
      })),
      detail: report
        ? {
            id: report.id,
            weekStart: report.weekStart,
            weekEnd: report.weekEnd,
            headline: sanitizeUserInput(report.content.headline),
            daysActive: report.facts.daysActive,
            mealsLogged: report.facts.mealsLogged,
            proteinDaysMet: sensitive ? null : report.facts.proteinDaysMet,
            caloriesDaysMet: sensitive ? null : report.facts.caloriesDaysMet,
            wins: report.content.wins.map(sanitizeUserInput),
            watch: report.content.watch.map(sanitizeUserInput),
            fromLogged:
              report.content.fromLogged === null
                ? null
                : sanitizeUserInput(report.content.fromLogged),
            celebrate: report.facts.celebrate,
            sensitiveWeek: sensitive,
          }
        : null,
    };
  },
});

export const WEEKLY_REPORT_TOOLS: CoachToolEntry[] = [getWeeklyReportsTool];
