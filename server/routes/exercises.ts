import type { Express, Request, Response } from "express";
import { z, ZodError } from "zod";
import { requireAuth } from "../middleware/auth";
import { storage } from "../storage";
import {
  formatZodError,
  parsePositiveIntParam,
  parseQueryInt,
  parseQueryDate,
  parseQueryString,
  crudRateLimit,
} from "./_helpers";
import { sendError } from "../lib/api-errors";
import { calculateCaloriesBurned } from "../services/exercise-calorie";
import { DEFAULT_NUTRITION_GOALS } from "@shared/constants/nutrition";

const createExerciseLogSchema = z.object({
  exerciseName: z.string().min(1).max(200),
  exerciseType: z.enum([
    "cardio",
    "strength",
    "flexibility",
    "sports",
    "other",
  ]),
  durationMinutes: z.number().int().positive().max(1440),
  caloriesBurned: z.number().positive().optional(),
  intensity: z.enum(["light", "moderate", "vigorous"]).optional(),
  sets: z.number().int().positive().optional(),
  reps: z.number().int().positive().optional(),
  weightLifted: z.number().positive().optional(),
  distanceKm: z.number().positive().optional(),
  source: z.enum(["manual", "healthkit"]).default("manual"),
  notes: z.string().max(500).optional(),
});

const updateExerciseLogSchema = createExerciseLogSchema.partial();

export function register(app: Express): void {
  // Daily exercise summary — defined BEFORE the parameterized :id routes
  app.get(
    "/api/exercises/summary",
    requireAuth,
    crudRateLimit,
    async (req: Request, res: Response) => {
      try {
        const date = parseQueryDate(req.query.date) ?? new Date();
        const summary = await storage.getExerciseDailySummary(
          req.userId!,
          date,
        );
        res.json(summary);
      } catch (error) {
        console.error("Get exercise summary error:", error);
        sendError(res, 500, "Failed to get exercise summary");
      }
    },
  );

  // Get exercise logs
  app.get(
    "/api/exercises",
    requireAuth,
    crudRateLimit,
    async (req: Request, res: Response) => {
      try {
        const from = parseQueryDate(req.query.from);
        const to = parseQueryDate(req.query.to);
        const limit = req.query.limit
          ? parseQueryInt(req.query.limit, { default: 50, max: 100 })
          : undefined;
        const logs = await storage.getExerciseLogs(req.userId!, {
          from,
          to,
          limit,
        });
        res.json(logs);
      } catch (error) {
        console.error("Get exercise logs error:", error);
        sendError(res, 500, "Failed to get exercise logs");
      }
    },
  );

  // Log exercise
  app.post(
    "/api/exercises",
    requireAuth,
    crudRateLimit,
    async (req: Request, res: Response) => {
      try {
        const validated = createExerciseLogSchema.parse(req.body);

        // Auto-calculate calories if not provided
        let caloriesBurned = validated.caloriesBurned;
        if (!caloriesBurned) {
          // Look up MET value from library
          const exercises = await storage.searchExerciseLibrary(
            validated.exerciseName,
            req.userId!,
          );
          const match = exercises.find(
            (e) =>
              e.name.toLowerCase() === validated.exerciseName.toLowerCase(),
          );
          if (match) {
            const user = await storage.getUser(req.userId!);
            const weightKg = user?.weight ? parseFloat(user.weight) : 70;
            caloriesBurned = calculateCaloriesBurned(
              parseFloat(match.metValue),
              weightKg,
              validated.durationMinutes,
            );
          }
        }

        const log = await storage.createExerciseLog({
          userId: req.userId!,
          exerciseName: validated.exerciseName,
          exerciseType: validated.exerciseType,
          durationMinutes: validated.durationMinutes,
          caloriesBurned: caloriesBurned?.toString(),
          intensity: validated.intensity,
          sets: validated.sets,
          reps: validated.reps,
          weightLifted: validated.weightLifted?.toString(),
          distanceKm: validated.distanceKm?.toString(),
          source: validated.source,
          notes: validated.notes,
        });

        res.status(201).json(log);
      } catch (error) {
        if (error instanceof ZodError) {
          return sendError(res, 400, formatZodError(error));
        }
        console.error("Create exercise log error:", error);
        sendError(res, 500, "Failed to log exercise");
      }
    },
  );

  // Update exercise log
  app.put(
    "/api/exercises/:id",
    requireAuth,
    crudRateLimit,
    async (req: Request, res: Response) => {
      try {
        const id = parsePositiveIntParam(req.params.id);
        if (!id) return sendError(res, 400, "Invalid exercise log ID");
        const validated = updateExerciseLogSchema.parse(req.body);
        const updates: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(validated)) {
          if (value !== undefined) {
            if (
              ["caloriesBurned", "weightLifted", "distanceKm"].includes(key)
            ) {
              updates[key] = value?.toString();
            } else {
              updates[key] = value;
            }
          }
        }
        const updated = await storage.updateExerciseLog(
          id,
          req.userId!,
          updates,
        );
        if (!updated) return sendError(res, 404, "Exercise log not found");
        res.json(updated);
      } catch (error) {
        if (error instanceof ZodError)
          return sendError(res, 400, formatZodError(error));
        console.error("Update exercise log error:", error);
        sendError(res, 500, "Failed to update exercise log");
      }
    },
  );

  // Delete exercise log
  app.delete(
    "/api/exercises/:id",
    requireAuth,
    crudRateLimit,
    async (req: Request, res: Response) => {
      try {
        const id = parsePositiveIntParam(req.params.id);
        if (!id) return sendError(res, 400, "Invalid exercise log ID");
        const deleted = await storage.deleteExerciseLog(id, req.userId!);
        if (!deleted) return sendError(res, 404, "Exercise log not found");
        res.status(204).send();
      } catch (error) {
        console.error("Delete exercise log error:", error);
        sendError(res, 500, "Failed to delete exercise log");
      }
    },
  );

  // Search exercise library
  app.get(
    "/api/exercise-library",
    requireAuth,
    crudRateLimit,
    async (req: Request, res: Response) => {
      try {
        const query = parseQueryString(req.query.q) || "";
        if (query.length < 1) return res.json([]);
        const results = await storage.searchExerciseLibrary(query, req.userId!);
        res.json(results);
      } catch (error) {
        console.error("Search exercise library error:", error);
        sendError(res, 500, "Failed to search exercises");
      }
    },
  );

  // Add custom exercise to library
  app.post(
    "/api/exercise-library",
    requireAuth,
    crudRateLimit,
    async (req: Request, res: Response) => {
      try {
        const schema = z.object({
          name: z.string().min(1).max(200),
          type: z.enum([
            "cardio",
            "strength",
            "flexibility",
            "sports",
            "other",
          ]),
          metValue: z.number().positive().max(30),
        });
        const validated = schema.parse(req.body);
        const entry = await storage.createExerciseLibraryEntry({
          name: validated.name,
          type: validated.type,
          metValue: validated.metValue.toString(),
          isCustom: true,
          userId: req.userId!,
        });
        res.status(201).json(entry);
      } catch (error) {
        if (error instanceof ZodError)
          return sendError(res, 400, formatZodError(error));
        console.error("Create exercise library entry error:", error);
        sendError(res, 500, "Failed to create exercise");
      }
    },
  );

  // Daily calorie budget (goal + exercise burn)
  app.get(
    "/api/daily-budget",
    requireAuth,
    crudRateLimit,
    async (req: Request, res: Response) => {
      try {
        const date = parseQueryDate(req.query.date) ?? new Date();
        const user = await storage.getUser(req.userId!);
        if (!user) return sendError(res, 404, "User not found");

        const dailySummary = await storage.getDailySummary(req.userId!, date);
        const exerciseSummary = await storage.getExerciseDailySummary(
          req.userId!,
          date,
        );

        const calorieGoal =
          user.dailyCalorieGoal || DEFAULT_NUTRITION_GOALS.calories;
        const foodCalories = dailySummary.totalCalories;
        const exerciseCalories = exerciseSummary.totalCaloriesBurned;
        const adjustedBudget = calorieGoal + exerciseCalories;
        const remaining = adjustedBudget - foodCalories;

        res.json({
          calorieGoal,
          foodCalories,
          exerciseCalories,
          adjustedBudget,
          remaining,
          exerciseMinutes: exerciseSummary.totalMinutes,
          exerciseCount: exerciseSummary.exerciseCount,
        });
      } catch (error) {
        console.error("Get daily budget error:", error);
        sendError(res, 500, "Failed to get daily budget");
      }
    },
  );
}
