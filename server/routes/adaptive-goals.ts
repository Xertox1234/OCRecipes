import type { Express, Request, Response } from "express";
import { requireAuth } from "../middleware/auth";
import { storage } from "../storage";
import { checkPremiumFeature } from "./_helpers";
import { computeAdaptiveGoals } from "../services/adaptive-goals";

export function register(app: Express): void {
  // Get adaptive goals status + pending recommendation
  app.get(
    "/api/goals/adaptive",
    requireAuth,
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
        res.status(500).json({ error: "Failed to get adaptive goals" });
      }
    },
  );

  // Accept adaptive goal adjustment
  app.post(
    "/api/goals/adaptive/accept",
    requireAuth,
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
          return res.status(400).json({ error: "No pending recommendation" });
        }

        // Apply the new goals
        await storage.updateUser(req.userId!, {
          dailyCalorieGoal: recommendation.newCalories,
          dailyProteinGoal: recommendation.newProtein,
          dailyCarbsGoal: recommendation.newCarbs,
          dailyFatGoal: recommendation.newFat,
          lastGoalAdjustmentAt: new Date(),
        });

        // Log the adjustment
        await storage.createGoalAdjustmentLog({
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
        });

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
        res.status(500).json({ error: "Failed to accept adaptive goal" });
      }
    },
  );

  // Dismiss adaptive goal adjustment
  app.post(
    "/api/goals/adaptive/dismiss",
    requireAuth,
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
          // Log the dismissed adjustment
          await storage.createGoalAdjustmentLog({
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

          // Update last adjustment time to prevent re-showing immediately
          await storage.updateUser(req.userId!, {
            lastGoalAdjustmentAt: new Date(),
          });
        }

        res.json({ success: true });
      } catch (error) {
        console.error("Dismiss adaptive goal error:", error);
        res.status(500).json({ error: "Failed to dismiss adaptive goal" });
      }
    },
  );

  // Update adaptive goals settings (enable/disable)
  app.put(
    "/api/goals/adaptive/settings",
    requireAuth,
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
          return res.status(400).json({ error: "enabled must be a boolean" });
        }

        await storage.updateUser(req.userId!, {
          adaptiveGoalsEnabled: enabled,
        });

        res.json({ success: true, enabled });
      } catch (error) {
        console.error("Update adaptive goals settings error:", error);
        res.status(500).json({ error: "Failed to update settings" });
      }
    },
  );

  // Get adjustment history
  app.get(
    "/api/goals/adjustment-history",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "adaptiveGoals",
          "Adaptive goals",
        );
        if (!features) return;

        const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
        const logs = await storage.getGoalAdjustmentLogs(req.userId!, limit);
        res.json(logs);
      } catch (error) {
        console.error("Get adjustment history error:", error);
        res.status(500).json({ error: "Failed to get adjustment history" });
      }
    },
  );
}
