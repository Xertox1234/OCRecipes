import type { Express, Request, Response } from "express";
import { requireAuth } from "../middleware/auth";
import { storage } from "../storage";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { checkPremiumFeature, parseQueryInt, crudRateLimit } from "./_helpers";
import { computeAdaptiveGoals } from "../services/adaptive-goals";

export function register(app: Express): void {
  // Get adaptive goals status + pending recommendation
  app.get(
    "/api/goals/adaptive",
    requireAuth,
    crudRateLimit,
    async (req: Request, res: Response) => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "adaptiveGoals",
          "Adaptive goals",
        );
        if (!features) return;

        const user = await storage.getUser(req.userId!);
        const recommendation = await computeAdaptiveGoals(req.userId!);
        res.json({
          enabled: user?.adaptiveGoalsEnabled ?? false,
          hasRecommendation: recommendation !== null,
          recommendation,
        });
      } catch (error) {
        console.error("Get adaptive goals error:", error);
        sendError(
          res,
          500,
          "Failed to get adaptive goals",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // Accept adaptive goal adjustment
  app.post(
    "/api/goals/adaptive/accept",
    requireAuth,
    crudRateLimit,
    async (req: Request, res: Response) => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "adaptiveGoals",
          "Adaptive goals",
        );
        if (!features) return;

        const recommendation = await computeAdaptiveGoals(req.userId!);
        if (!recommendation) {
          return sendError(
            res,
            400,
            "No pending recommendation",
            ErrorCode.VALIDATION_ERROR,
          );
        }

        // Apply goals + audit log atomically
        await storage.applyAdaptiveGoalsAtomically(
          req.userId!,
          {
            dailyCalorieGoal: recommendation.newCalories,
            dailyProteinGoal: recommendation.newProtein,
            dailyCarbsGoal: recommendation.newCarbs,
            dailyFatGoal: recommendation.newFat,
          },
          {
            userId: req.userId!,
            previousCalories: recommendation.previousCalories,
            newCalories: recommendation.newCalories,
            previousProtein: recommendation.previousProtein,
            newProtein: recommendation.newProtein,
            previousCarbs: recommendation.previousCarbs,
            newCarbs: recommendation.newCarbs,
            previousFat: recommendation.previousFat,
            newFat: recommendation.newFat,
            reason: recommendation.reason,
            weightTrendRate: recommendation.weightTrendRate?.toString(),
            acceptedByUser: true,
          },
        );

        res.json({
          success: true,
          appliedGoals: {
            calories: recommendation.newCalories,
            protein: recommendation.newProtein,
            carbs: recommendation.newCarbs,
            fat: recommendation.newFat,
          },
        });
      } catch (error) {
        console.error("Accept adaptive goal error:", error);
        sendError(
          res,
          500,
          "Failed to accept adaptive goal",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // Dismiss adaptive goal adjustment
  app.post(
    "/api/goals/adaptive/dismiss",
    requireAuth,
    crudRateLimit,
    async (req: Request, res: Response) => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "adaptiveGoals",
          "Adaptive goals",
        );
        if (!features) return;

        const recommendation = await computeAdaptiveGoals(req.userId!);
        if (recommendation) {
          // Log dismissed adjustment + update timestamp atomically
          await storage.dismissAdaptiveGoalsAtomically(req.userId!, {
            userId: req.userId!,
            previousCalories: recommendation.previousCalories,
            newCalories: recommendation.newCalories,
            previousProtein: recommendation.previousProtein,
            newProtein: recommendation.newProtein,
            previousCarbs: recommendation.previousCarbs,
            newCarbs: recommendation.newCarbs,
            previousFat: recommendation.previousFat,
            newFat: recommendation.newFat,
            reason: recommendation.reason,
            weightTrendRate: recommendation.weightTrendRate?.toString(),
            acceptedByUser: false,
          });
        }

        res.json({ success: true });
      } catch (error) {
        console.error("Dismiss adaptive goal error:", error);
        sendError(
          res,
          500,
          "Failed to dismiss adaptive goal",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // Update adaptive goals settings (enable/disable)
  app.put(
    "/api/goals/adaptive/settings",
    requireAuth,
    crudRateLimit,
    async (req: Request, res: Response) => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "adaptiveGoals",
          "Adaptive goals",
        );
        if (!features) return;

        const { enabled } = req.body;
        if (typeof enabled !== "boolean") {
          return sendError(
            res,
            400,
            "enabled must be a boolean",
            ErrorCode.VALIDATION_ERROR,
          );
        }

        await storage.updateUser(req.userId!, {
          adaptiveGoalsEnabled: enabled,
        });

        res.json({ success: true, enabled });
      } catch (error) {
        console.error("Update adaptive goals settings error:", error);
        sendError(
          res,
          500,
          "Failed to update settings",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // Get adjustment history
  app.get(
    "/api/goals/adjustment-history",
    requireAuth,
    crudRateLimit,
    async (req: Request, res: Response) => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "adaptiveGoals",
          "Adaptive goals",
        );
        if (!features) return;

        const limit = parseQueryInt(req.query.limit, { default: 50, max: 100 });
        const logs = await storage.getGoalAdjustmentLogs(req.userId!, limit);
        res.json(logs);
      } catch (error) {
        console.error("Get adjustment history error:", error);
        sendError(
          res,
          500,
          "Failed to get adjustment history",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );
}
