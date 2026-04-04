import type { Express, Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { storage } from "../storage";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import {
  checkPremiumFeature,
  handleRouteError,
  parseQueryInt,
} from "./_helpers";
import { crudRateLimit } from "./_rate-limiters";
import { computeAdaptiveGoals } from "../services/adaptive-goals";

export function register(app: Express): void {
  // Get adaptive goals status + pending recommendation
  app.get(
    "/api/goals/adaptive",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "adaptiveGoals",
          "Adaptive goals",
        );
        if (!features) return;

        const user = await storage.getUser(req.userId);
        const recommendation = await computeAdaptiveGoals(req.userId);
        res.json({
          enabled: user?.adaptiveGoalsEnabled ?? false,
          hasRecommendation: recommendation !== null,
          recommendation,
        });
      } catch (error) {
        handleRouteError(res, error, "get adaptive goals");
      }
    },
  );

  // Accept adaptive goal adjustment
  app.post(
    "/api/goals/adaptive/accept",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "adaptiveGoals",
          "Adaptive goals",
        );
        if (!features) return;

        const recommendation = await computeAdaptiveGoals(req.userId);
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
          req.userId,
          {
            dailyCalorieGoal: recommendation.newCalories,
            dailyProteinGoal: recommendation.newProtein,
            dailyCarbsGoal: recommendation.newCarbs,
            dailyFatGoal: recommendation.newFat,
          },
          {
            userId: req.userId,
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
        handleRouteError(res, error, "accept adaptive goal");
      }
    },
  );

  // Dismiss adaptive goal adjustment
  app.post(
    "/api/goals/adaptive/dismiss",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "adaptiveGoals",
          "Adaptive goals",
        );
        if (!features) return;

        const recommendation = await computeAdaptiveGoals(req.userId);
        if (recommendation) {
          // Log dismissed adjustment + update timestamp atomically
          await storage.dismissAdaptiveGoalsAtomically(req.userId, {
            userId: req.userId,
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
        handleRouteError(res, error, "dismiss adaptive goal");
      }
    },
  );

  // Update adaptive goals settings (enable/disable)
  app.put(
    "/api/goals/adaptive/settings",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
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

        await storage.updateUser(req.userId, {
          adaptiveGoalsEnabled: enabled,
        });

        res.json({ success: true, enabled });
      } catch (error) {
        handleRouteError(res, error, "update adaptive goals settings");
      }
    },
  );

  // Get adjustment history
  app.get(
    "/api/goals/adjustment-history",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "adaptiveGoals",
          "Adaptive goals",
        );
        if (!features) return;

        const limit = parseQueryInt(req.query.limit, { default: 50, max: 100 });
        const logs = await storage.getGoalAdjustmentLogs(req.userId, limit);
        res.json(logs);
      } catch (error) {
        handleRouteError(res, error, "get adjustment history");
      }
    },
  );
}
