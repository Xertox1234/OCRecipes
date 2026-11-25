import type { Express, Request, Response } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { storage } from "../storage";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import {
  formatZodError,
  handleRouteError,
  parsePositiveIntParam,
  parseTimezone,
} from "./_helpers";
import { refusedWhileCoachNotesPaused } from "./_health-consent";
import { refusedNoteText } from "./_note-text";
import { civilDateString, civilDateToInstant } from "../lib/civil-date";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { crudRateLimit, ipKeyGenerator } from "./_rate-limiters";

const acceptSchema = z.object({
  title: z.string().trim().min(1).max(120),
  // Written by the model, so it is read leniently: see cardDate.
  followUpDate: z.string().max(40),
});

/**
 * The card's check-in day at the user's local midnight, or null for one that
 * is not a calendar day or has passed. The commitment is saved either way.
 */
function cardDate(value: string, tz: string): Date | null {
  const day = z.iso.date().safeParse(value.slice(0, 10));
  if (!day.success || day.data < civilDateString(new Date(), tz)) return null;
  return civilDateToInstant(day.data, tz);
}

export function register(app: Express): void {
  // POST /api/chat/commitments — Accept on a commitment card.
  app.post(
    "/api/chat/commitments",
    requireAuth,
    // Inline (not the crudRateLimit const) so CodeQL's js/missing-rate-limiting
    // query can trace it (see server/routes/coach-context.ts).
    rateLimit({
      windowMs: 60 * 1000,
      max: 30,
      message: {
        error: "Too many requests. Please wait.",
        code: ErrorCode.RATE_LIMITED,
      },
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req: Request) => req.userId || ipKeyGenerator(req),
    }),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const parsed = acceptSchema.safeParse(req.body);
        if (!parsed.success) {
          return sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
        }
        if (await refusedWhileCoachNotesPaused(req.userId, res)) return;
        const { title, followUpDate } = parsed.data;
        const refusal = refusedNoteText(title);
        if (refusal) {
          return sendError(res, 400, refusal, ErrorCode.VALIDATION_ERROR);
        }
        const result = await storage.acceptCommitment(req.userId, {
          title,
          followUpDate: cardDate(
            followUpDate,
            parseTimezone(req.headers["x-timezone"]),
          ),
        });
        if (result === "full") {
          return sendError(
            res,
            409,
            "Your notebook is full. Remove some notes to add new ones.",
            ErrorCode.LIMIT_REACHED,
          );
        }
        res.json({ ok: true });
      } catch (error) {
        handleRouteError(res, error, "accept commitment card");
      }
    },
  );

  // Kept for installed apps that send a note id. Current ones use the above.
  app.post(
    "/api/chat/commitments/:notebookEntryId/accept",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const notebookEntryId = parsePositiveIntParam(
          req.params.notebookEntryId,
        );
        if (!notebookEntryId) {
          return sendError(
            res,
            400,
            "Invalid notebookEntryId",
            ErrorCode.VALIDATION_ERROR,
          );
        }
        const entry = await storage.getNotebookEntryById(
          notebookEntryId,
          req.userId,
        );
        if (!entry) {
          return sendError(
            res,
            404,
            "Commitment not found",
            ErrorCode.NOT_FOUND,
          );
        }
        if (entry.type !== "commitment") {
          return sendError(
            res,
            400,
            "Entry is not a commitment",
            ErrorCode.VALIDATION_ERROR,
          );
        }
        if (await refusedWhileCoachNotesPaused(req.userId, res)) return;
        // Only an active commitment: accepting must not bring back one the
        // user removed or one that was archived. Accepting starts it, so it
        // stays active (L64: it used to be completed, which dropped its
        // follow-up).
        if (entry.status !== "active") {
          return sendError(
            res,
            409,
            "This commitment is no longer active",
            ErrorCode.CONFLICT,
          );
        }
        await storage.confirmNotebookEntries(req.userId, [notebookEntryId]);
        res.json({ ok: true });
      } catch (error) {
        handleRouteError(res, error, "accept commitment");
      }
    },
  );
}
