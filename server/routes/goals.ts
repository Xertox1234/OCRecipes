import type { Express, Response } from "express";
import { z, ZodError } from "zod";
import { storage } from "../storage";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import {
  calculateGoals,
  userPhysicalProfileSchema,
} from "../services/goal-calculator";
import { ErrorCode } from "@shared/constants/error-codes";
import { formatZodError, crudRateLimit, parseQueryDate } from "./_helpers";
import { DEFAULT_NUTRITION_GOALS } from "@shared/constants/nutrition";

// Zod schema for manual goal update
const updateGoalsSchema = z.object({
  dailyCalorieGoal: z.number().int().min(500).max(10000).optional(),
  dailyProteinGoal: z.number().int().min(0).max(500).optional(),
  dailyCarbsGoal: z.number().int().min(0).max(1000).optional(),
  dailyFatGoal: z.number().int().min(0).max(500).optional(),
});

export function register(app: Express): void {
  app.get(
    "/api/goals",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const user = await storage.getUser(req.userId);
        if (!user) {
          return sendError(res, 404, "User not found", ErrorCode.NOT_FOUND);
        }

        res.json({
          dailyCalorieGoal: user.dailyCalorieGoal,
          dailyProteinGoal: user.dailyProteinGoal,
          dailyCarbsGoal: user.dailyCarbsGoal,
          dailyFatGoal: user.dailyFatGoal,
          goalsCalculatedAt: user.goalsCalculatedAt,
        });
      } catch (error) {
        console.error("Get goals error:", error);
        sendError(res, 500, "Failed to fetch goals", ErrorCode.INTERNAL_ERROR);
      }
    },
  );

  app.post(
    "/api/goals/calculate",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const validated = userPhysicalProfileSchema.parse(req.body);

        // Calculate goals using the service
        const goals = calculateGoals(validated);

        // Update user with physical profile and calculated goals
        await storage.updateUser(req.userId, {
          weight: validated.weight.toString(),
          height: validated.height.toString(),
          age: validated.age,
          gender: validated.gender,
          dailyCalorieGoal: goals.dailyCalories,
          dailyProteinGoal: goals.dailyProtein,
          dailyCarbsGoal: goals.dailyCarbs,
          dailyFatGoal: goals.dailyFat,
          goalsCalculatedAt: new Date(),
        });

        // Also update profile with activity level and primary goal
        const existingProfile = await storage.getUserProfile(req.userId);
        if (existingProfile) {
          await storage.updateUserProfile(req.userId, {
            activityLevel: validated.activityLevel,
            primaryGoal: validated.primaryGoal,
          });
        } else {
          await storage.createUserProfile({
            userId: req.userId,
            activityLevel: validated.activityLevel,
            primaryGoal: validated.primaryGoal,
          });
        }

        res.json({
          ...goals,
          profile: {
            weight: validated.weight,
            height: validated.height,
            age: validated.age,
            gender: validated.gender,
            activityLevel: validated.activityLevel,
            primaryGoal: validated.primaryGoal,
          },
        });
      } catch (error) {
        if (error instanceof ZodError) {
          return sendError(
            res,
            400,
            formatZodError(error),
            ErrorCode.VALIDATION_ERROR,
          );
        }
        console.error("Calculate goals error:", error);
        sendError(
          res,
          500,
          "Failed to calculate goals",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  app.put(
    "/api/goals",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const validated = updateGoalsSchema.parse(req.body);

        const updatedUser = await storage.updateUser(req.userId, {
          ...(validated.dailyCalorieGoal !== undefined && {
            dailyCalorieGoal: validated.dailyCalorieGoal,
          }),
          ...(validated.dailyProteinGoal !== undefined && {
            dailyProteinGoal: validated.dailyProteinGoal,
          }),
          ...(validated.dailyCarbsGoal !== undefined && {
            dailyCarbsGoal: validated.dailyCarbsGoal,
          }),
          ...(validated.dailyFatGoal !== undefined && {
            dailyFatGoal: validated.dailyFatGoal,
          }),
        });

        if (!updatedUser) {
          return sendError(res, 404, "User not found", ErrorCode.NOT_FOUND);
        }

        res.json({
          dailyCalorieGoal: updatedUser.dailyCalorieGoal,
          dailyProteinGoal: updatedUser.dailyProteinGoal,
          dailyCarbsGoal: updatedUser.dailyCarbsGoal,
          dailyFatGoal: updatedUser.dailyFatGoal,
        });
      } catch (error) {
        if (error instanceof ZodError) {
          return sendError(
            res,
            400,
            formatZodError(error),
            ErrorCode.VALIDATION_ERROR,
          );
        }
        console.error("Update goals error:", error);
        sendError(res, 500, "Failed to update goals", ErrorCode.INTERNAL_ERROR);
      }
    },
  );

  // Daily calorie budget
  app.get(
    "/api/daily-budget",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const date = parseQueryDate(req.query.date) ?? new Date();
        const user = await storage.getUser(req.userId);
        if (!user)
          return sendError(res, 404, "User not found", ErrorCode.NOT_FOUND);

        const dailySummary = await storage.getDailySummary(req.userId, date);

        const calorieGoal =
          user.dailyCalorieGoal || DEFAULT_NUTRITION_GOALS.calories;
        const foodCalories = dailySummary.totalCalories;
        const remaining = calorieGoal - foodCalories;

        res.json({
          calorieGoal,
          foodCalories,
          remaining,
        });
      } catch (error) {
        console.error("Get daily budget error:", error);
        sendError(
          res,
          500,
          "Failed to get daily budget",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );
}
