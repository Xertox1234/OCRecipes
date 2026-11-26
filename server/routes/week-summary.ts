// server/routes/week-summary.ts
import type { Express, Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { civilDateString } from "../lib/civil-date";
import { readWeekCalories } from "../services/week-progress";
import { weekSummaryRateLimit } from "./_rate-limiters";
import {
  handleRouteError,
  parseQueryDateString,
  parseTimezone,
} from "./_helpers";

/**
 * GET /api/daily-summary/week?end=YYYY-MM-DD — the calories of `end` (today
 * in the user's zone when left out) and the six days before it, oldest
 * first. The Coach's week card (roadmap T3) re-reads its week with this: one
 * request, where seven /api/daily-summary reads would use up the count that
 * logging food shares. Each day is that route's own read.
 */
export function register(app: Express): void {
  app.get(
    "/api/daily-summary/week",
    requireAuth,
    weekSummaryRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const tz = parseTimezone(req.headers["x-timezone"]);
        const end = parseQueryDateString(req.query.end);
        if (req.query.end !== undefined && end === undefined) {
          sendError(
            res,
            400,
            "end must be a valid yyyy-mm-dd calendar date",
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }
        const endDate = end ?? civilDateString(new Date(), tz);
        const calories = await readWeekCalories(req.userId, endDate, tz);
        res.json({ endDate, calories });
      } catch (error) {
        handleRouteError(res, error, "fetch week summary");
      }
    },
  );
}
