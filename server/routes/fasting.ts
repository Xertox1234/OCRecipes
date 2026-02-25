import type { Express, Request, Response } from "express";
import { z } from "zod";
import { fastingRateLimit, formatZodError } from "./_helpers";
import { storage } from "../storage";
import { requireAuth } from "../middleware/auth";
import { calculateFastingStats } from "../services/fasting-stats";

export function register(app: Express): void {
  // GET /api/fasting/schedule
  app.get(
    "/api/fasting/schedule",
    requireAuth,
    fastingRateLimit,
    async (req: Request, res: Response) => {
      try {
        const schedule = await storage.getFastingSchedule(req.userId!);
        res.json(schedule || null);
      } catch (error) {
        console.error("Get fasting schedule error:", error);
        res.status(500).json({ error: "Failed to get fasting schedule" });
      }
    },
  );

  // PUT /api/fasting/schedule
  app.put(
    "/api/fasting/schedule",
    requireAuth,
    fastingRateLimit,
    async (req: Request, res: Response) => {
      try {
        const schema = z.object({
          protocol: z.enum(["16:8", "18:6", "20:4", "5:2", "custom"]),
          fastingHours: z.number().int().min(1).max(23),
          eatingHours: z.number().int().min(1).max(23),
          eatingWindowStart: z
            .string()
            .regex(/^\d{2}:\d{2}$/)
            .optional(),
          eatingWindowEnd: z
            .string()
            .regex(/^\d{2}:\d{2}$/)
            .optional(),
          isActive: z.boolean().optional(),
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success)
          return res.status(400).json({ error: formatZodError(parsed.error) });

        const result = await storage.upsertFastingSchedule(
          req.userId!,
          parsed.data,
        );
        res.json(result);
      } catch (error) {
        console.error("Update fasting schedule error:", error);
        res.status(500).json({ error: "Failed to update fasting schedule" });
      }
    },
  );

  // POST /api/fasting/start
  app.post(
    "/api/fasting/start",
    requireAuth,
    fastingRateLimit,
    async (req: Request, res: Response) => {
      try {
        // Check no active fast
        const active = await storage.getActiveFastingLog(req.userId!);
        if (active)
          return res
            .status(409)
            .json({ error: "A fast is already in progress" });

        const schedule = await storage.getFastingSchedule(req.userId!);
        const targetHours = schedule?.fastingHours || 16;

        const log = await storage.createFastingLog({
          userId: req.userId!,
          targetDurationHours: targetHours,
        });
        res.status(201).json(log);
      } catch (error) {
        console.error("Start fast error:", error);
        res.status(500).json({ error: "Failed to start fast" });
      }
    },
  );

  // POST /api/fasting/end
  app.post(
    "/api/fasting/end",
    requireAuth,
    fastingRateLimit,
    async (req: Request, res: Response) => {
      try {
        const schema = z.object({ note: z.string().max(500).optional() });
        const parsed = schema.safeParse(req.body);

        const active = await storage.getActiveFastingLog(req.userId!);
        if (!active)
          return res.status(404).json({ error: "No active fast found" });

        const now = new Date();
        const startedAt = new Date(active.startedAt);
        const actualMinutes = Math.round(
          (now.getTime() - startedAt.getTime()) / 60000,
        );
        const targetMinutes = active.targetDurationHours * 60;
        const completed = actualMinutes >= targetMinutes * 0.9; // 90% threshold

        const updated = await storage.endFastingLog(
          active.id,
          req.userId!,
          now,
          actualMinutes,
          completed,
          parsed.success ? parsed.data.note : undefined,
        );
        res.json(updated);
      } catch (error) {
        console.error("End fast error:", error);
        res.status(500).json({ error: "Failed to end fast" });
      }
    },
  );

  // GET /api/fasting/current
  app.get(
    "/api/fasting/current",
    requireAuth,
    fastingRateLimit,
    async (req: Request, res: Response) => {
      try {
        const active = await storage.getActiveFastingLog(req.userId!);
        res.json(active || null);
      } catch (error) {
        console.error("Get current fast error:", error);
        res.status(500).json({ error: "Failed to get current fast" });
      }
    },
  );

  // GET /api/fasting/history
  app.get(
    "/api/fasting/history",
    requireAuth,
    fastingRateLimit,
    async (req: Request, res: Response) => {
      try {
        const limit = Math.min(parseInt(req.query.limit as string) || 30, 100);

        const logs = await storage.getFastingLogs(req.userId!, limit);
        const stats = calculateFastingStats(logs);
        res.json({ logs, stats });
      } catch (error) {
        console.error("Get fasting history error:", error);
        res.status(500).json({ error: "Failed to get fasting history" });
      }
    },
  );
}
