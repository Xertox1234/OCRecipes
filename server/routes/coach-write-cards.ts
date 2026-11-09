import type { Express, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { parseTimezone } from "../lib/civil-date";
import { fireAndForget } from "../lib/fire-and-forget";
import {
  afterWriteCardSave,
  performWriteCardSave,
  revertWriteCardSave,
  writeCardReceiptFor,
  WriteCardEditError,
} from "../services/write-cards";
import { coachCardRateLimit } from "./_rate-limiters";
import { formatZodError, handleRouteError } from "./_helpers";

/**
 * Coach write cards (spec 2026-11-09): the user's tap. Save works from the
 * card row the server stored — the body carries only the user's edits, which
 * the card kind's strict schema checks. Every lookup is by (card id, userId),
 * so another user's card reads as 404.
 */

const cardIdSchema = z.string().uuid();
const saveBodySchema = z
  .object({ edits: z.record(z.string(), z.unknown()).optional() })
  .strict();

export function register(app: Express): void {
  app.post(
    "/api/coach/cards/:id/save",
    requireAuth,
    coachCardRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const id = cardIdSchema.safeParse(req.params.id);
        if (!id.success) {
          return sendError(
            res,
            400,
            "Invalid card id",
            ErrorCode.VALIDATION_ERROR,
          );
        }
        const body = saveBodySchema.safeParse(req.body ?? {});
        if (!body.success) {
          return sendError(
            res,
            400,
            formatZodError(body.error),
            ErrorCode.VALIDATION_ERROR,
          );
        }
        const userId = req.userId;
        const tz = parseTimezone(req.headers["x-timezone"]);
        const now = new Date();
        const result = await storage.saveWriteCard(
          id.data,
          userId,
          (tx, card) =>
            performWriteCardSave(tx, card, body.data.edits ?? card.edits, {
              userId,
              tz,
              now,
            }),
          body.data.edits,
        );
        switch (result.status) {
          case "not_found":
            return sendError(res, 404, "Card not found", ErrorCode.NOT_FOUND);
          case "locked":
            return sendError(
              res,
              409,
              "This card was replaced by a newer one.",
              ErrorCode.CARD_LOCKED,
            );
          case "saved":
            fireAndForget(
              "coach-write-card-after-save",
              afterWriteCardSave(result.card),
            );
            return res.status(201).json({
              status: "saved",
              receipt: writeCardReceiptFor(result.card),
            });
          case "already_saved":
            return res.status(200).json({
              status: "saved",
              receipt: writeCardReceiptFor(result.card),
            });
        }
      } catch (error) {
        if (error instanceof WriteCardEditError) {
          return sendError(res, 400, error.message, ErrorCode.VALIDATION_ERROR);
        }
        handleRouteError(res, error, "save coach card");
      }
    },
  );

  app.post(
    "/api/coach/cards/:id/undo",
    requireAuth,
    coachCardRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const id = cardIdSchema.safeParse(req.params.id);
        if (!id.success) {
          return sendError(
            res,
            400,
            "Invalid card id",
            ErrorCode.VALIDATION_ERROR,
          );
        }
        const result = await storage.undoWriteCard(
          id.data,
          req.userId,
          revertWriteCardSave,
        );
        switch (result.status) {
          case "not_found":
            return sendError(res, 404, "Card not found", ErrorCode.NOT_FOUND);
          case "too_late":
            return sendError(
              res,
              409,
              "It's too late to undo this.",
              ErrorCode.UNDO_EXPIRED,
            );
          case "not_saved":
            return sendError(
              res,
              409,
              "This card isn't saved.",
              ErrorCode.CARD_NOT_SAVED,
            );
          case "undone":
            return res.status(200).json({ status: result.card.status });
        }
      } catch (error) {
        handleRouteError(res, error, "undo coach card");
      }
    },
  );
}
