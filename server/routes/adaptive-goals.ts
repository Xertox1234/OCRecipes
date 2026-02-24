import type { Express, Request, Response } from "express";
import { requireAuth } from "../middleware/auth";
import { storage } from "../storage";
import { checkPremiumFeature } from "./_helpers";
import { computeAdaptiveGoals } from "../services/adaptive-goals";
import type { PremiumFeatureKey } from "@shared/types/premium";

// Cast needed until the other agent adds "adaptiveGoals" to PremiumFeatures
const ADAPTIVE_GOALS_FEATURE = "adaptiveGoals" as PremiumFeatureKey;

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
          ADAPTIVE_GOALS_FEATURE,
          "Adaptive goals",
        );
        if (!features) return;

        const recommendation = await computeAdaptiveGoals(req.userId!);
        res.json({
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
          ADAPTIVE_GOALS_FEATURE,
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
          ADAPTIVE_GOALS_FEATURE,
          "Adaptive goals",
        );
        if (!features) return;

        res.json({ success: true });
      } catch (error) {
        console.error("Dismiss adaptive goal error:", error);
        res.status(500).json({ error: "Failed to dismiss adaptive goal" });
      }
    },
  );
}
