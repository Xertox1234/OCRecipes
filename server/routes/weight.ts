import type { Express, Request, Response } from "express";
import { z, ZodError } from "zod";
import { requireAuth } from "../middleware/auth";
import { storage } from "../storage";
import { formatZodError } from "./_helpers";
import { calculateWeightTrend } from "../services/weight-trend";

const createWeightLogSchema = z.object({
  weight: z.number().positive().max(999),
  source: z.enum(["manual", "healthkit", "scale"]).default("manual"),
  note: z.string().max(500).optional(),
  loggedAt: z.string().datetime().optional(),
});

const weightGoalSchema = z.object({
  goalWeight: z.number().positive().max(999).nullable(),
});

export function register(app: Express): void {
  // Get weight logs
  app.get("/api/weight", requireAuth, async (req: Request, res: Response) => {
    try {
      const from = req.query.from
        ? new Date(req.query.from as string)
        : undefined;
      const to = req.query.to ? new Date(req.query.to as string) : undefined;
      const limit = req.query.limit
        ? Math.min(parseInt(req.query.limit as string, 10) || 50, 100)
        : undefined;

      // Free users: limit to last 7 entries
      const subscription = await storage.getSubscriptionStatus(req.userId!);
      const tier = subscription?.tier || "free";
      const effectiveLimit = tier === "free" ? 7 : limit;

      const logs = await storage.getWeightLogs(req.userId!, {
        from,
        to,
        limit: effectiveLimit,
      });
      res.json(logs);
    } catch (error) {
      console.error("Get weight logs error:", error);
      res.status(500).json({ error: "Failed to get weight logs" });
    }
  });

  // Get weight trend (premium for full trend, free gets basic)
  // NOTE: This must be registered BEFORE /api/weight/:id to avoid route conflict
  app.get(
    "/api/weight/trend",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const user = await storage.getUser(req.userId!);
        if (!user) {
          return res.status(404).json({ error: "User not found" });
        }

        const logs = await storage.getWeightLogs(req.userId!);
        const goalWeight = user.goalWeight ? parseFloat(user.goalWeight) : null;
        const trend = calculateWeightTrend(logs, goalWeight);

        // Free users get basic trend only
        const subscription = await storage.getSubscriptionStatus(req.userId!);
        const tier = subscription?.tier || "free";
        if (tier === "free") {
          res.json({
            currentWeight: trend.currentWeight,
            weeklyRateOfChange: trend.weeklyRateOfChange,
            entries: trend.entries,
          });
          return;
        }

        res.json({ ...trend, goalWeight });
      } catch (error) {
        console.error("Get weight trend error:", error);
        res.status(500).json({ error: "Failed to get weight trend" });
      }
    },
  );

  // Log weight entry
  app.post("/api/weight", requireAuth, async (req: Request, res: Response) => {
    try {
      const validated = createWeightLogSchema.parse(req.body);
      const log = await storage.createWeightLog({
        userId: req.userId!,
        weight: validated.weight.toString(),
        source: validated.source,
        note: validated.note,
      });

      // Also update the user's weight field
      await storage.updateUser(req.userId!, {
        weight: validated.weight.toString(),
      });

      res.status(201).json(log);
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({ error: formatZodError(error) });
      }
      console.error("Create weight log error:", error);
      res.status(500).json({ error: "Failed to log weight" });
    }
  });

  // Delete weight entry
  app.delete(
    "/api/weight/:id",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const id = parseInt(req.params.id as string, 10);
        if (isNaN(id)) {
          return res.status(400).json({ error: "Invalid weight log ID" });
        }
        const deleted = await storage.deleteWeightLog(id, req.userId!);
        if (!deleted) {
          return res.status(404).json({ error: "Weight log not found" });
        }
        res.json({ success: true });
      } catch (error) {
        console.error("Delete weight log error:", error);
        res.status(500).json({ error: "Failed to delete weight log" });
      }
    },
  );

  // Set goal weight
  app.put(
    "/api/goals/weight",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const validated = weightGoalSchema.parse(req.body);
        const user = await storage.updateUser(req.userId!, {
          goalWeight: validated.goalWeight?.toString() ?? null,
        });
        if (!user) {
          return res.status(404).json({ error: "User not found" });
        }
        res.json({ goalWeight: user.goalWeight });
      } catch (error) {
        if (error instanceof ZodError) {
          return res.status(400).json({ error: formatZodError(error) });
        }
        console.error("Set goal weight error:", error);
        res.status(500).json({ error: "Failed to set goal weight" });
      }
    },
  );
}
