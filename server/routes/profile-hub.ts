import type { Express, Response } from "express";
import { type AuthenticatedRequest, requireAuth } from "../middleware/auth";
import { storage } from "../storage";
import { handleRouteError, createRateLimiter } from "./_helpers";
import { DEFAULT_NUTRITION_GOALS } from "@shared/constants/nutrition";
import { logger, toError } from "../lib/logger";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";

const hubRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 15,
  message: "Too many profile requests. Please wait.",
});

export function register(app: Express): void {
  // ── Widget data (calorie budget, fasting status, weight trend) ──────────
  app.get(
    "/api/profile/widgets",
    requireAuth,
    hubRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const date = new Date();

        const [user, dailySummary, schedule, currentFast, latestWeight] =
          await Promise.all([
            storage.getUser(req.userId),
            storage.getDailySummary(req.userId, date),
            storage.getFastingSchedule(req.userId),
            storage.getActiveFastingLog(req.userId),
            storage.getLatestWeight(req.userId),
          ]);

        if (!user)
          return sendError(res, 404, "User not found", ErrorCode.NOT_FOUND);

        const calorieGoal =
          user.dailyCalorieGoal || DEFAULT_NUTRITION_GOALS.calories;
        const foodCalories = Number(dailySummary.totalCalories) || 0;

        res.json({
          dailyBudget: {
            calorieGoal,
            foodCalories,
            remaining: calorieGoal - foodCalories,
          },
          fasting: {
            schedule: schedule ?? null,
            currentFast: currentFast ?? null,
          },
          latestWeight: latestWeight
            ? {
                value: Number(latestWeight.weight),
                unit: "lbs",
                date: new Date(latestWeight.loggedAt).toISOString(),
              }
            : null,
        });
      } catch (error) {
        handleRouteError(res, error, "get profile widgets");
      }
    },
  );

  // ── Library counts (single SQL with subselects) ─────────────────────────
  app.get(
    "/api/profile/library-counts",
    requireAuth,
    hubRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const counts = await storage.getLibraryCounts(req.userId);
        res.json(counts);
      } catch (error) {
        handleRouteError(res, error, "get library counts");
      }
    },
  );
}
