import type { Express, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import {
  getPremiumFeatures,
  handleRouteError,
  parseTimezone,
} from "./_helpers";
import { hasShowableReminder } from "../services/coach-brief";
import { reminderMutesSchema } from "./_schemas";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import {
  remindersPendingRateLimit,
  remindersAcknowledgeRateLimit,
  remindersMutesRateLimit,
} from "./_rate-limiters";

export function register(app: Express): void {
  // GET /api/reminders/pending
  app.get(
    "/api/reminders/pending",
    requireAuth,
    remindersPendingRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        // The same check the brief makes, so the dot never lights for a
        // reminder the brief has nothing to say about (L90, L110).
        const hasPending = await hasShowableReminder(
          req.userId,
          await getPremiumFeatures(req),
          parseTimezone(req.headers["x-timezone"]),
        );
        res.json({ hasPending });
      } catch (error) {
        handleRouteError(res, error, "check pending reminders");
      }
    },
  );

  // POST /api/reminders/acknowledge-type — clear one reminder type only.
  const acknowledgeTypeSchema = z.object({
    type: z.enum(["meal-log", "commitment", "daily-checkin", "user-set"]),
  });
  app.post(
    "/api/reminders/acknowledge-type",
    requireAuth,
    remindersAcknowledgeRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const parsed = acknowledgeTypeSchema.safeParse(req.body);
        if (!parsed.success) {
          return sendError(
            res,
            400,
            "Unknown reminder type",
            ErrorCode.VALIDATION_ERROR,
          );
        }
        const acknowledged = await storage.acknowledgeReminderType(
          req.userId,
          parsed.data.type,
        );
        res.json({ acknowledged });
      } catch (error) {
        handleRouteError(res, error, "acknowledge reminder type");
      }
    },
  );

  // POST /api/reminders/acknowledge
  app.post(
    "/api/reminders/acknowledge",
    requireAuth,
    remindersAcknowledgeRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const coachContext = await storage.acknowledgeReminders(req.userId);
        res.json({ acknowledged: coachContext.length, coachContext });
      } catch (error) {
        handleRouteError(res, error, "acknowledge reminders");
      }
    },
  );

  // PATCH /api/reminders/mutes
  app.patch(
    "/api/reminders/mutes",
    requireAuth,
    remindersMutesRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const parsed = reminderMutesSchema.safeParse(req.body);
        if (!parsed.success) {
          return sendError(
            res,
            400,
            "Invalid mute keys",
            ErrorCode.VALIDATION_ERROR,
          );
        }

        const reminderMutes = await storage.saveReminderMutes(
          req.userId,
          parsed.data,
        );
        res.json({ reminderMutes });
      } catch (error) {
        handleRouteError(res, error, "update reminder mutes");
      }
    },
  );
}
