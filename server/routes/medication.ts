import type { Express, Request, Response } from "express";
import { z } from "zod";
import {
  medicationRateLimit,
  formatZodError,
  checkPremiumFeature,
  parsePositiveIntParam,
  parseQueryInt,
  parseQueryDate,
} from "./_helpers";
import { sendError } from "../lib/api-errors";
import { storage } from "../storage";
import { requireAuth } from "../middleware/auth";
import { analyzeGlp1Insights } from "../services/glp1-insights";
import type { ProteinSuggestion } from "@shared/types/protein-suggestions";
import { DEFAULT_NUTRITION_GOALS } from "@shared/constants/nutrition";

export function register(app: Express): void {
  // GET /api/medication/logs
  app.get(
    "/api/medication/logs",
    requireAuth,
    medicationRateLimit,
    async (req: Request, res: Response) => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "glp1Companion",
          "GLP-1 Companion",
        );
        if (!features) return;

        const from = parseQueryDate(req.query.from);
        const to = parseQueryDate(req.query.to);
        const limit = parseQueryInt(req.query.limit, { default: 50, max: 100 });

        const logs = await storage.getMedicationLogs(req.userId!, {
          from,
          to,
          limit,
        });
        res.json(logs);
      } catch (error) {
        console.error("Get medication logs error:", error);
        sendError(res, 500, "Failed to get medication logs");
      }
    },
  );

  // POST /api/medication/log
  app.post(
    "/api/medication/log",
    requireAuth,
    medicationRateLimit,
    async (req: Request, res: Response) => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "glp1Companion",
          "GLP-1 Companion",
        );
        if (!features) return;

        const schema = z.object({
          medicationName: z.string().max(100),
          brandName: z.string().max(100).optional(),
          dosage: z.string().max(50),
          sideEffects: z.array(z.string().max(100)).max(10).optional(),
          appetiteLevel: z.number().int().min(1).max(5).optional(),
          notes: z.string().max(500).optional(),
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success)
          return sendError(res, 400, formatZodError(parsed.error));

        const log = await storage.createMedicationLog({
          userId: req.userId!,
          ...parsed.data,
        });
        res.status(201).json(log);
      } catch (error) {
        console.error("Create medication log error:", error);
        sendError(res, 500, "Failed to create medication log");
      }
    },
  );

  // PUT /api/medication/log/:id
  app.put(
    "/api/medication/log/:id",
    requireAuth,
    medicationRateLimit,
    async (req: Request, res: Response) => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "glp1Companion",
          "GLP-1 Companion",
        );
        if (!features) return;

        const id = parsePositiveIntParam(req.params.id);
        if (!id) return sendError(res, 400, "Invalid log ID");

        const schema = z.object({
          medicationName: z.string().max(100).optional(),
          brandName: z.string().max(100).optional(),
          dosage: z.string().max(50).optional(),
          sideEffects: z.array(z.string().max(100)).max(10).optional(),
          appetiteLevel: z.number().int().min(1).max(5).optional(),
          notes: z.string().max(500).optional(),
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success)
          return sendError(res, 400, formatZodError(parsed.error));

        const updated = await storage.updateMedicationLog(
          id,
          req.userId!,
          parsed.data,
        );
        if (!updated) return sendError(res, 404, "Medication log not found");
        res.json(updated);
      } catch (error) {
        console.error("Update medication log error:", error);
        sendError(res, 500, "Failed to update medication log");
      }
    },
  );

  // DELETE /api/medication/log/:id
  app.delete(
    "/api/medication/log/:id",
    requireAuth,
    medicationRateLimit,
    async (req: Request, res: Response) => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "glp1Companion",
          "GLP-1 Companion",
        );
        if (!features) return;

        const id = parsePositiveIntParam(req.params.id);
        if (!id) return sendError(res, 400, "Invalid log ID");

        const deleted = await storage.deleteMedicationLog(id, req.userId!);
        if (!deleted) return sendError(res, 404, "Medication log not found");
        res.status(204).send();
      } catch (error) {
        console.error("Delete medication log error:", error);
        sendError(res, 500, "Failed to delete medication log");
      }
    },
  );

  // GET /api/medication/insights
  app.get(
    "/api/medication/insights",
    requireAuth,
    medicationRateLimit,
    async (req: Request, res: Response) => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "glp1Companion",
          "GLP-1 Companion",
        );
        if (!features) return;

        const insights = await analyzeGlp1Insights(req.userId!);
        res.json(insights);
      } catch (error) {
        console.error("Get medication insights error:", error);
        sendError(res, 500, "Failed to get medication insights");
      }
    },
  );

  // GET /api/medication/protein-suggestions
  app.get(
    "/api/medication/protein-suggestions",
    requireAuth,
    medicationRateLimit,
    async (req: Request, res: Response) => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "glp1Companion",
          "GLP-1 Companion",
        );
        if (!features) return;

        // Get user goals and daily summary to calculate remaining protein
        const user = await storage.getUser(req.userId!);
        const dailySummary = await storage.getDailySummary(
          req.userId!,
          new Date(),
        );
        const proteinGoal =
          user?.dailyProteinGoal ?? DEFAULT_NUTRITION_GOALS.protein;
        const remainingProtein = Math.max(
          0,
          proteinGoal - Number(dailySummary.totalProtein),
        );

        // Get recent appetite level from medication logs
        const recentLogs = await storage.getMedicationLogs(req.userId!, {
          limit: 1,
        });
        const appetiteLevel = recentLogs[0]?.appetiteLevel ?? 3;

        // Generate protein-focused suggestions based on appetite
        const suggestions = generateProteinSuggestions(
          remainingProtein,
          appetiteLevel,
        );
        res.json({ suggestions, remainingProtein, proteinGoal });
      } catch (error) {
        console.error("Get protein suggestions error:", error);
        sendError(res, 500, "Failed to get protein suggestions");
      }
    },
  );

  // PUT /api/user/glp1-mode
  app.put(
    "/api/user/glp1-mode",
    requireAuth,
    medicationRateLimit,
    async (req: Request, res: Response) => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "glp1Companion",
          "GLP-1 Companion",
        );
        if (!features) return;

        const schema = z.object({
          glp1Mode: z.boolean(),
          glp1Medication: z.string().max(100).optional(),
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success)
          return sendError(res, 400, formatZodError(parsed.error));

        const updates: Record<string, unknown> = {
          glp1Mode: parsed.data.glp1Mode,
        };
        if (parsed.data.glp1Medication) {
          updates.glp1Medication = parsed.data.glp1Medication;
        }
        if (parsed.data.glp1Mode) {
          updates.glp1StartDate = new Date();
        }

        const profile = await storage.updateUserProfile(req.userId!, updates);
        if (!profile) return sendError(res, 404, "Profile not found");
        res.json(profile);
      } catch (error) {
        console.error("Update GLP-1 mode error:", error);
        sendError(res, 500, "Failed to update GLP-1 mode");
      }
    },
  );
}

// Low-appetite suggestions for GLP-1 users with reduced hunger
const LOW_APPETITE_SUGGESTIONS: ProteinSuggestion[] = [
  {
    title: "Greek Yogurt Parfait",
    description: "High-protein yogurt with berries — light and easy to eat",
    proteinGrams: 20,
    calories: 180,
    portionSize: "1 cup",
  },
  {
    title: "Protein Shake",
    description: "Whey or plant protein blended with milk and banana",
    proteinGrams: 30,
    calories: 250,
    portionSize: "12 oz",
  },
  {
    title: "Cottage Cheese & Fruit",
    description: "Creamy cottage cheese topped with peach slices",
    proteinGrams: 24,
    calories: 200,
    portionSize: "1 cup",
  },
];

// Moderate appetite suggestions
const MODERATE_APPETITE_SUGGESTIONS: ProteinSuggestion[] = [
  {
    title: "Turkey & Cheese Roll-Ups",
    description:
      "Deli turkey wrapped around cheese sticks — quick protein snack",
    proteinGrams: 28,
    calories: 220,
    portionSize: "4 rolls",
  },
  {
    title: "Hard-Boiled Eggs & Hummus",
    description: "Two eggs with a side of hummus and veggies",
    proteinGrams: 18,
    calories: 260,
    portionSize: "2 eggs + 3 tbsp",
  },
  {
    title: "Tuna Salad Lettuce Wraps",
    description: "Light tuna salad in crisp lettuce cups",
    proteinGrams: 32,
    calories: 280,
    portionSize: "2 wraps",
  },
];

// Higher appetite suggestions
const HIGH_APPETITE_SUGGESTIONS: ProteinSuggestion[] = [
  {
    title: "Grilled Chicken Bowl",
    description: "Seasoned chicken over rice with steamed broccoli",
    proteinGrams: 40,
    calories: 420,
    portionSize: "6 oz chicken",
  },
  {
    title: "Salmon & Sweet Potato",
    description: "Baked salmon fillet with roasted sweet potato",
    proteinGrams: 35,
    calories: 380,
    portionSize: "5 oz salmon",
  },
  {
    title: "Lentil & Chicken Soup",
    description: "Hearty soup packed with lentils and shredded chicken",
    proteinGrams: 30,
    calories: 350,
    portionSize: "2 cups",
  },
];

function generateProteinSuggestions(
  remainingProtein: number,
  appetiteLevel: number,
): ProteinSuggestion[] {
  let pool: ProteinSuggestion[];
  if (appetiteLevel <= 2) {
    pool = LOW_APPETITE_SUGGESTIONS;
  } else if (appetiteLevel <= 3) {
    pool = MODERATE_APPETITE_SUGGESTIONS;
  } else {
    pool = HIGH_APPETITE_SUGGESTIONS;
  }

  // Return up to 3 suggestions, filtering out those exceeding remaining protein by too much
  return pool
    .filter((s) => s.proteinGrams <= remainingProtein + 10)
    .slice(0, 3);
}
