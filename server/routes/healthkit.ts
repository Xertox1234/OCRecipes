import type { Express, Response } from "express";
import { z } from "zod";
import { type AuthenticatedRequest, requireAuth } from "../middleware/auth";
import { storage } from "../storage";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import {
  handleRouteError,
  checkPremiumFeature,
  crudRateLimit,
} from "./_helpers";
import { syncHealthKitData } from "../services/healthkit-sync";
import { logger, toError } from "../lib/logger";

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
      dataType: z.enum(["weight", "steps", "active_energy", "sleep"]),
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
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "healthKitSync",
          "HealthKit sync",
        );
        if (!features) return;

        const validated = syncDataSchema.parse(req.body);
        const result = await syncHealthKitData(req.userId, validated);
        res.json(result);
      } catch (error) {
        handleRouteError(res, error, "sync HealthKit data");
      }
    },
  );

  // Get sync preferences
  app.get(
    "/api/healthkit/settings",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const settings = await storage.getHealthKitSyncSettings(req.userId);
        res.json(settings);
      } catch (error) {
        logger.error({ err: toError(error) }, "get HealthKit settings error");
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
    async (req: AuthenticatedRequest, res: Response) => {
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
            req.userId,
            setting.dataType,
            setting.enabled,
            setting.syncDirection,
          );
          results.push(result);
        }
        res.json(results);
      } catch (error) {
        handleRouteError(res, error, "update HealthKit settings");
      }
    },
  );
}
