import type { Express, Request, Response } from "express";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import {
  ipKeyGenerator,
  formatZodError,
  checkPremiumFeature,
} from "./_helpers";
import { storage } from "../storage";
import { requireAuth } from "../middleware/auth";
import { analyzeGlp1Insights } from "../services/glp1-insights";

const medicationRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: "Too many medication requests. Please wait." },
  keyGenerator: (req) => req.userId || ipKeyGenerator(req),
  standardHeaders: true,
  legacyHeaders: false,
});

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

        const from = req.query.from
          ? new Date(req.query.from as string)
          : undefined;
        const to = req.query.to ? new Date(req.query.to as string) : undefined;
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

        const logs = await storage.getMedicationLogs(req.userId!, {
          from,
          to,
          limit,
        });
        res.json(logs);
      } catch (error) {
        console.error("Get medication logs error:", error);
        res.status(500).json({ error: "Failed to get medication logs" });
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
          return res.status(400).json({ error: formatZodError(parsed.error) });

        const log = await storage.createMedicationLog({
          userId: req.userId!,
          ...parsed.data,
        });
        res.status(201).json(log);
      } catch (error) {
        console.error("Create medication log error:", error);
        res.status(500).json({ error: "Failed to create medication log" });
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

        const id = parseInt(req.params.id as string, 10);
        if (isNaN(id)) return res.status(400).json({ error: "Invalid log ID" });

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
          return res.status(400).json({ error: formatZodError(parsed.error) });

        const updated = await storage.updateMedicationLog(
          id,
          req.userId!,
          parsed.data,
        );
        if (!updated)
          return res.status(404).json({ error: "Medication log not found" });
        res.json(updated);
      } catch (error) {
        console.error("Update medication log error:", error);
        res.status(500).json({ error: "Failed to update medication log" });
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

        const id = parseInt(req.params.id as string, 10);
        if (isNaN(id)) return res.status(400).json({ error: "Invalid log ID" });

        const deleted = await storage.deleteMedicationLog(id, req.userId!);
        if (!deleted)
          return res.status(404).json({ error: "Medication log not found" });
        res.json({ success: true });
      } catch (error) {
        console.error("Delete medication log error:", error);
        res.status(500).json({ error: "Failed to delete medication log" });
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
        res.status(500).json({ error: "Failed to get medication insights" });
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
          return res.status(400).json({ error: formatZodError(parsed.error) });

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
        if (!profile)
          return res.status(404).json({ error: "Profile not found" });
        res.json(profile);
      } catch (error) {
        console.error("Update GLP-1 mode error:", error);
        res.status(500).json({ error: "Failed to update GLP-1 mode" });
      }
    },
  );
}
