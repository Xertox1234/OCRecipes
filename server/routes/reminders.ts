import type { Express, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { handleRouteError } from "./_helpers";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import type { ReminderMutes } from "@shared/types/reminders";

const mutesSchema = z
  .object({
    "meal-log": z.boolean().optional(),
    commitment: z.boolean().optional(),
    "daily-checkin": z.boolean().optional(),
  })
  .strict();

export function register(app: Express): void {
  // GET /api/reminders/pending
  app.get(
    "/api/reminders/pending",
    requireAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const hasPending = await storage.hasPendingReminders(req.userId);
        res.json({ hasPending });
      } catch (error) {
        handleRouteError(res, error, "check pending reminders");
      }
    },
  );

  // POST /api/reminders/acknowledge
  app.post(
    "/api/reminders/acknowledge",
    requireAuth,
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
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const parsed = mutesSchema.safeParse(req.body);
        if (!parsed.success) {
          return sendError(
            res,
            400,
            "Invalid mute keys",
            ErrorCode.VALIDATION_ERROR,
          );
        }

        const profile = await storage.getUserProfile(req.userId);
        const existing = (profile?.reminderMutes ?? {}) as ReminderMutes;
        const updated: ReminderMutes = { ...existing, ...parsed.data };

        await storage.updateUserProfile(req.userId, {
          reminderMutes: updated,
        });
        res.json({ reminderMutes: updated });
      } catch (error) {
        handleRouteError(res, error, "update reminder mutes");
      }
    },
  );
}
