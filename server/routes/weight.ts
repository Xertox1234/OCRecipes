import type { Express, Response } from "express";
import { z } from "zod";
import { type AuthenticatedRequest, requireAuth } from "../middleware/auth";
import { storage } from "../storage";
import { crudRateLimit } from "./_rate-limiters";
import {
  handleRouteError,
  parsePositiveIntParam,
  parseQueryInt,
  parseQueryDate,
} from "./_helpers";
import { sendError } from "../lib/api-errors";
import { logger, toError } from "../lib/logger";
import { ErrorCode } from "@shared/constants/error-codes";
import { calculateWeightTrend } from "../services/weight-trend";

const createWeightLogSchema = z.object({
  weight: z.number().positive().max(999),
  unit: z.enum(["lb", "kg"]).default("lb"),
  source: z.enum(["manual", "healthkit", "scale"]).default("manual"),
  note: z.string().max(500).optional(),
  loggedAt: z.string().datetime().optional(),
});

const weightGoalSchema = z.object({
  goalWeight: z.number().positive().max(999).nullable(),
});

export function register(app: Express): void {
  // Get weight logs
  app.get(
    "/api/weight",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const from = parseQueryDate(req.query.from);
        const to = parseQueryDate(req.query.to);
        const limit = req.query.limit
          ? parseQueryInt(req.query.limit, { default: 50, max: 100 })
          : undefined;

        // Free users: limit to last 7 entries
        const subscription = await storage.getSubscriptionStatus(req.userId);
        const tier = subscription?.tier || "free";
        const effectiveLimit = tier === "free" ? 7 : limit;

        const logs = await storage.getWeightLogs(req.userId, {
          from,
          to,
          limit: effectiveLimit,
        });
        res.json(logs);
      } catch (error) {
        logger.error({ err: toError(error) }, "get weight logs error");
        sendError(
          res,
          500,
          "Failed to get weight logs",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // Get weight trend (premium for full trend, free gets basic)
  // NOTE: This must be registered BEFORE /api/weight/:id to avoid route conflict
  app.get(
    "/api/weight/trend",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const user = await storage.getUser(req.userId);
        if (!user) {
          return sendError(res, 404, "User not found", ErrorCode.NOT_FOUND);
        }

        const logs = await storage.getWeightLogs(req.userId);
        const goalWeight = user.goalWeight ? parseFloat(user.goalWeight) : null;
        const trend = calculateWeightTrend(logs, goalWeight);

        // Free users get basic trend only
        const subscription = await storage.getSubscriptionStatus(req.userId);
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
        logger.error({ err: toError(error) }, "get weight trend error");
        sendError(
          res,
          500,
          "Failed to get weight trend",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // Log weight entry
  app.post(
    "/api/weight",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const validated = createWeightLogSchema.parse(req.body);

        // Normalize to kg for storage consistency. HealthKit already sends kg;
        // manual entries from the UI default to lb. See M25 audit finding.
        const weightKg =
          validated.unit === "lb"
            ? validated.weight * 0.453592
            : validated.weight;

        // Create weight log and update user's current weight atomically
        const log = await storage.createWeightLogAndUpdateUser({
          userId: req.userId,
          weight: weightKg.toFixed(2),
          unit: "kg",
          source: validated.source,
          note: validated.note,
        });

        res.status(201).json(log);
      } catch (error) {
        handleRouteError(res, error, "log weight");
      }
    },
  );

  // Delete weight entry
  app.delete(
    "/api/weight/:id",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const id = parsePositiveIntParam(req.params.id);
        if (!id) {
          return sendError(
            res,
            400,
            "Invalid weight log ID",
            ErrorCode.VALIDATION_ERROR,
          );
        }
        const deleted = await storage.deleteWeightLog(id, req.userId);
        if (!deleted) {
          return sendError(
            res,
            404,
            "Weight log not found",
            ErrorCode.NOT_FOUND,
          );
        }
        res.status(204).send();
      } catch (error) {
        logger.error({ err: toError(error) }, "delete weight log error");
        sendError(
          res,
          500,
          "Failed to delete weight log",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // Set goal weight
  app.put(
    "/api/goals/weight",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const validated = weightGoalSchema.parse(req.body);
        const user = await storage.updateUser(req.userId, {
          goalWeight: validated.goalWeight?.toString() ?? null,
        });
        if (!user) {
          return sendError(res, 404, "User not found", ErrorCode.NOT_FOUND);
        }
        res.json({ goalWeight: user.goalWeight });
      } catch (error) {
        handleRouteError(res, error, "set goal weight");
      }
    },
  );
}
