import type { Express, Response } from "express";
import { storage } from "../storage";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { handleRouteError, parsePositiveIntParam } from "./_helpers";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import type { CoachWeeklyReport } from "@shared/schema";
import {
  weeklyReportSettingsSchema,
  type WeeklyReport,
  type WeeklyReportList,
} from "@shared/schemas/coach-weekly-report";
import {
  weeklyReportsReadRateLimit,
  weeklyReportsWriteRateLimit,
} from "./_rate-limiters";

/**
 * Coach weekly report (spec docs/superpowers/specs/2026-11-10-coach-weekly-report-design.md).
 * Every route is scoped to req.userId. No Pro gate: a user keeps reading the
 * reports they own after a lapse; only generation is gated.
 */

const TREND_WEEKS = 6;
const settingsPatchSchema = weeklyReportSettingsSchema.partial().strict();

function toApi(r: CoachWeeklyReport): WeeklyReport {
  return {
    id: r.id,
    weekStart: r.weekStart,
    weekEnd: r.weekEnd,
    facts: r.facts,
    content: r.content,
    seenAt: r.seenAt?.toISOString() ?? null,
    celebrationShownAt: r.celebrationShownAt?.toISOString() ?? null,
    deliveredVia: r.deliveredVia ?? null,
  };
}

export function register(app: Express): void {
  app.get(
    "/api/weekly-reports",
    requireAuth,
    weeklyReportsReadRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const rows = await storage.listWeeklyReports(req.userId);
        const body: WeeklyReportList = {
          reports: rows.map((r) => ({
            id: r.id,
            weekStart: r.weekStart,
            weekEnd: r.weekEnd,
            headline: r.content.headline,
            seen: r.seenAt !== null,
          })),
          trends: rows
            .slice(0, TREND_WEEKS)
            .reverse()
            .map((r) => ({
              weekStart: r.weekStart,
              proteinDaysMet: r.facts.proteinDaysMet,
              daysActive: r.facts.daysActive,
              recipesAdded: r.facts.recipesAdded,
            })),
        };
        res.json(body);
      } catch (error) {
        handleRouteError(res, error, "list weekly reports");
      }
    },
  );

  app.get(
    "/api/weekly-reports/pending-popup",
    requireAuth,
    weeklyReportsReadRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const r = await storage.getPendingPopup(req.userId);
        res.json({ report: r ? toApi(r) : null });
      } catch (error) {
        handleRouteError(res, error, "get pending weekly report popup");
      }
    },
  );

  app.get(
    "/api/weekly-reports/settings",
    requireAuth,
    weeklyReportsReadRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        res.json(await storage.getWeeklyReportSettings(req.userId));
      } catch (error) {
        handleRouteError(res, error, "get weekly report settings");
      }
    },
  );

  app.put(
    "/api/weekly-reports/settings",
    requireAuth,
    weeklyReportsWriteRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const parsed = settingsPatchSchema.safeParse(req.body);
        if (!parsed.success) {
          return sendError(
            res,
            400,
            "Invalid weekly report settings",
            ErrorCode.VALIDATION_ERROR,
          );
        }
        res.json(
          await storage.setWeeklyReportSettings(req.userId, parsed.data),
        );
      } catch (error) {
        handleRouteError(res, error, "update weekly report settings");
      }
    },
  );

  app.get(
    "/api/weekly-reports/:id",
    requireAuth,
    weeklyReportsReadRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const id = parsePositiveIntParam(req.params.id);
        if (id === null) {
          return sendError(
            res,
            400,
            "Invalid report id",
            ErrorCode.VALIDATION_ERROR,
          );
        }
        const r = await storage.getWeeklyReport(req.userId, id);
        if (!r)
          return sendError(res, 404, "Report not found", ErrorCode.NOT_FOUND);
        res.json(toApi(r));
      } catch (error) {
        handleRouteError(res, error, "get weekly report");
      }
    },
  );

  /** POST /:id/<action> on a report the caller owns. */
  function postMark(
    action: string,
    run: (userId: string, id: number, res: Response) => Promise<void>,
  ) {
    app.post(
      `/api/weekly-reports/:id/${action}`,
      requireAuth,
      weeklyReportsWriteRateLimit,
      async (req: AuthenticatedRequest, res: Response) => {
        try {
          const id = parsePositiveIntParam(req.params.id);
          if (id === null) {
            return sendError(
              res,
              400,
              "Invalid report id",
              ErrorCode.VALIDATION_ERROR,
            );
          }
          if (!(await storage.getWeeklyReport(req.userId, id))) {
            return sendError(res, 404, "Report not found", ErrorCode.NOT_FOUND);
          }
          await run(req.userId, id, res);
        } catch (error) {
          handleRouteError(res, error, `weekly report ${action}`);
        }
      },
    );
  }

  postMark("seen", async (userId, id, res) => {
    res.json({ updated: await storage.markWeeklyReportSeen(userId, id) });
  });

  postMark("celebration-shown", async (userId, id, res) => {
    res.json({ updated: await storage.markCelebrationShown(userId, id) });
  });

  // The popup's delivery claim: 409 means a push (or another device) already
  // delivered this report, and the app closes the sheet quietly.
  postMark("popup-shown", async (userId, id, res) => {
    if (!(await storage.claimWeeklyReportDelivery(userId, id, "popup"))) {
      sendError(res, 409, "Report already delivered", ErrorCode.CONFLICT);
      return;
    }
    res.json({ claimed: true });
  });
}
