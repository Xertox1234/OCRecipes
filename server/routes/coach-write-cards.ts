import type { Express, Request, Response } from "express";
import { rateLimit } from "express-rate-limit";
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
import { ipKeyGenerator, resolveRateLimitMax } from "./_rate-limiters";
import { formatZodError, handleRouteError } from "./_helpers";

/**
 * Coach write cards (spec 2026-11-09): the user's tap. Save works from the
 * card row the server stored — the body carries only the user's edits, which
 * the card kind's strict schema checks. Every lookup is by (card id, userId),
 * so another user's card reads as 404.
 */

/**
 * Limiters are built with rateLimit() inline in each route, not the
 * _rate-limiters factory, so CodeQL's js/missing-rate-limiting can trace them
 * — the factory indirection is invisible to its dataflow (same as
 * recipe-search.ts's trending route). Same behaviour as a factory limiter:
 * user-keyed with the IP fallback (after requireAuth, so req.userId is set)
 * and the E2E-relaxed max. 30 a minute each: a person taps these a few times
 * a minute at most.
 */
const CARD_LIMIT_WINDOW_MS = 60_000;
const CARD_LIMIT_MAX = 30;
const cardLimitMessage = {
  error: "Too many card requests. Please wait.",
  code: ErrorCode.RATE_LIMITED,
};

const cardIdSchema = z.string().uuid();
const saveBodySchema = z
  .object({ edits: z.record(z.string(), z.unknown()).optional() })
  .strict();

export function register(app: Express): void {
  app.post(
    "/api/coach/cards/:id/save",
    requireAuth,
    rateLimit({
      windowMs: CARD_LIMIT_WINDOW_MS,
      max: resolveRateLimitMax(CARD_LIMIT_MAX, process.env),
      message: cardLimitMessage,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req: Request) => req.userId || ipKeyGenerator(req),
    }),
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
        // Side effects outside the database (the recipe search index) run
        // only once the save has committed; a rolled-back save drops them.
        const afterCommit: (() => void)[] = [];
        const result = await storage.saveWriteCard(
          id.data,
          userId,
          (tx, card) =>
            performWriteCardSave(tx, card, body.data.edits ?? card.edits, {
              userId,
              tz,
              now,
              afterCommit: (fn) => afterCommit.push(fn),
            }),
          body.data.edits,
        );
        for (const fn of afterCommit) fn();
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
    rateLimit({
      windowMs: CARD_LIMIT_WINDOW_MS,
      max: resolveRateLimitMax(CARD_LIMIT_MAX, process.env),
      message: cardLimitMessage,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req: Request) => req.userId || ipKeyGenerator(req),
    }),
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
        const afterCommit: (() => void)[] = [];
        const result = await storage.undoWriteCard(
          id.data,
          req.userId,
          (tx, card) =>
            revertWriteCardSave(tx, card, (fn) => afterCommit.push(fn)),
        );
        for (const fn of afterCommit) fn();
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
