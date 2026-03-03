import type { Express, Request, Response } from "express";
import { z, ZodError } from "zod";
import { requireAuth } from "../middleware/auth";
import { storage } from "../storage";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { formatZodError, checkPremiumFeature, crudRateLimit } from "./_helpers";
import { syncHealthKitData } from "../services/healthkit-sync";

const syncDataSchema = z.object({
  weights: z
    .array(
      z.object({
        weight: z.number().positive(),
        date: z.string().datetime(),
        source: z.string().default("healthkit"),
      }),
    )
    .optional(),
  workouts: z
    .array(
      z.object({
        name: z.string(),
        type: z.string(),
        durationMinutes: z.number().positive(),
        caloriesBurned: z.number().nonnegative(),
        date: z.string().datetime(),
        source: z.string().default("healthkit"),
      }),
    )
    .optional(),
  steps: z
    .array(
      z.object({
        date: z.string(),
        count: z.number().nonnegative(),
      }),
    )
    .optional(),
});

const syncSettingsSchema = z.object({
  settings: z.array(
    z.object({
      dataType: z.enum([
        "weight",
        "steps",
        "workouts",
        "active_energy",
        "sleep",
      ]),
      enabled: z.boolean(),
      syncDirection: z.enum(["read", "write", "both"]).default("read"),
    }),
  ),
});

export function register(app: Express): void {
  // Sync HealthKit data from client
  app.post(
    "/api/healthkit/sync",
    requireAuth,
    crudRateLimit,
    async (req: Request, res: Response) => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "healthKitSync",
          "HealthKit sync",
        );
        if (!features) return;

        const validated = syncDataSchema.parse(req.body);
        const result = await syncHealthKitData(req.userId!, validated);
        res.json(result);
      } catch (error) {
        if (error instanceof ZodError) {
          return sendError(
            res,
            400,
            formatZodError(error),
            ErrorCode.VALIDATION_ERROR,
          );
        }
        console.error("HealthKit sync error:", error);
        sendError(
          res,
          500,
          "Failed to sync HealthKit data",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // Get sync preferences
  app.get(
    "/api/healthkit/settings",
    requireAuth,
    crudRateLimit,
    async (req: Request, res: Response) => {
      try {
        const settings = await storage.getHealthKitSyncSettings(req.userId!);
        res.json(settings);
      } catch (error) {
        console.error("Get HealthKit settings error:", error);
        sendError(
          res,
          500,
          "Failed to get HealthKit settings",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // Update sync preferences
  app.put(
    "/api/healthkit/settings",
    requireAuth,
    crudRateLimit,
    async (req: Request, res: Response) => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "healthKitSync",
          "HealthKit sync",
        );
        if (!features) return;

        const validated = syncSettingsSchema.parse(req.body);
        const results = [];
        for (const setting of validated.settings) {
          const result = await storage.upsertHealthKitSyncSetting(
            req.userId!,
            setting.dataType,
            setting.enabled,
            setting.syncDirection,
          );
          results.push(result);
        }
        res.json(results);
      } catch (error) {
        if (error instanceof ZodError) {
          return sendError(
            res,
            400,
            formatZodError(error),
            ErrorCode.VALIDATION_ERROR,
          );
        }
        console.error("Update HealthKit settings error:", error);
        sendError(
          res,
          500,
          "Failed to update HealthKit settings",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );
}
