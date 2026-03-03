import type { Express, Request, Response } from "express";
import { z, ZodError } from "zod";
import { storage } from "../storage";
import { requireAuth } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { calculateProfileHash } from "../utils/profile-hash";
import {
  generateMealSuggestions,
  buildSuggestionCacheKey,
} from "../services/meal-suggestions";
import type { MealSuggestion } from "@shared/types/meal-suggestions";
import { DEFAULT_NUTRITION_GOALS } from "@shared/constants/nutrition";
import {
  mealSuggestionRateLimit,
  formatZodError,
  checkPremiumFeature,
} from "./_helpers";

const suggestMealSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]),
});

export function register(app: Express): void {
  // POST /api/meal-plan/suggest — Generate 3 AI meal suggestions (premium)
  app.post(
    "/api/meal-plan/suggest",
    requireAuth,
    mealSuggestionRateLimit,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const parsed = suggestMealSchema.safeParse(req.body);
        if (!parsed.success) {
          sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        // Premium check
        const features = await checkPremiumFeature(
          req,
          res,
          "aiMealSuggestions",
          "AI meal suggestions",
        );
        if (!features) return;

        // Daily limit check
        const dailyCount = await storage.getDailyMealSuggestionCount(
          req.userId!,
          new Date(),
        );
        if (dailyCount >= features.dailyAiSuggestions) {
          sendError(
            res,
            429,
            "Daily AI suggestion limit reached",
            "DAILY_LIMIT_REACHED",
          );
          return;
        }

        // Build cache key
        const userProfile = await storage.getUserProfile(req.userId!);
        const user = await storage.getUser(req.userId!);
        const profileHash = userProfile
          ? calculateProfileHash(userProfile)
          : "no-profile";

        // Get existing meals for context
        const existingItems = await storage.getMealPlanItems(
          req.userId!,
          parsed.data.date,
          parsed.data.date,
        );
        const existingMeals = existingItems.map((item) => ({
          title:
            item.recipe?.title || item.scannedItem?.productName || "Unknown",
          calories: parseFloat(
            item.recipe?.caloriesPerServing ||
              item.scannedItem?.calories ||
              "0",
          ),
          mealType: item.mealType,
        }));

        const planHash = JSON.stringify(
          existingMeals.map((m) => m.title).sort(),
        );
        const cacheKey = buildSuggestionCacheKey(
          req.userId!,
          parsed.data.date,
          parsed.data.mealType,
          profileHash,
          planHash,
        );

        // Cache check
        const cached = await storage.getMealSuggestionCache(cacheKey);
        if (cached) {
          await storage.incrementMealSuggestionCacheHit(cached.id);
          const remaining = features.dailyAiSuggestions - dailyCount;
          res.json({
            suggestions: cached.suggestions as MealSuggestion[],
            remainingToday: remaining,
          });
          return;
        }

        // Calculate remaining budget
        const dailyTargets = {
          calories: user?.dailyCalorieGoal || DEFAULT_NUTRITION_GOALS.calories,
          protein: user?.dailyProteinGoal || DEFAULT_NUTRITION_GOALS.protein,
          carbs: user?.dailyCarbsGoal || DEFAULT_NUTRITION_GOALS.carbs,
          fat: user?.dailyFatGoal || DEFAULT_NUTRITION_GOALS.fat,
        };

        // Use actual confirmed intake from daily summary (includes scans + confirmed meals)
        const actualIntake = await storage.getDailySummary(
          req.userId!,
          new Date(parsed.data.date),
        );

        let consumedCalories = Number(actualIntake.totalCalories) || 0;
        let consumedProtein = Number(actualIntake.totalProtein) || 0;
        let consumedCarbs = Number(actualIntake.totalCarbs) || 0;
        let consumedFat = Number(actualIntake.totalFat) || 0;

        // Also account for planned-but-not-yet-confirmed meals
        for (const item of existingItems) {
          const servings = parseFloat(item.servings || "1");
          if (item.recipe) {
            consumedCalories +=
              parseFloat(item.recipe.caloriesPerServing || "0") * servings;
            consumedProtein +=
              parseFloat(item.recipe.proteinPerServing || "0") * servings;
            consumedCarbs +=
              parseFloat(item.recipe.carbsPerServing || "0") * servings;
            consumedFat +=
              parseFloat(item.recipe.fatPerServing || "0") * servings;
          } else if (item.scannedItem) {
            consumedCalories +=
              parseFloat(item.scannedItem.calories || "0") * servings;
            consumedProtein +=
              parseFloat(item.scannedItem.protein || "0") * servings;
            consumedCarbs +=
              parseFloat(item.scannedItem.carbs || "0") * servings;
            consumedFat += parseFloat(item.scannedItem.fat || "0") * servings;
          }
        }

        const remainingBudget = {
          calories: Math.max(0, dailyTargets.calories - consumedCalories),
          protein: Math.max(0, dailyTargets.protein - consumedProtein),
          carbs: Math.max(0, dailyTargets.carbs - consumedCarbs),
          fat: Math.max(0, dailyTargets.fat - consumedFat),
        };

        const suggestions = await generateMealSuggestions({
          userId: req.userId!,
          date: parsed.data.date,
          mealType: parsed.data.mealType,
          userProfile: userProfile || null,
          dailyTargets,
          existingMeals,
          remainingBudget,
        });

        // Cache result (expires in 6 hours)
        const expiresAt = new Date(Date.now() + 6 * 60 * 60 * 1000);
        await storage.createMealSuggestionCache(
          cacheKey,
          req.userId!,
          suggestions,
          expiresAt,
        );

        const remaining = features.dailyAiSuggestions - dailyCount - 1;
        res.json({ suggestions, remainingToday: Math.max(0, remaining) });
      } catch (error) {
        if (error instanceof ZodError) {
          sendError(
            res,
            400,
            formatZodError(error),
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }
        console.error("Meal suggestion error:", error);
        sendError(
          res,
          500,
          "Failed to generate suggestions",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );
}
