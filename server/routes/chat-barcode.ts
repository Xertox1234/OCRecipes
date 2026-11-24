/**
 * POST /api/chat/conversations/:id/barcode — a barcode the app's camera read,
 * sent into the Coach chat. The reply is a stored assistant message carrying
 * a one-serving food log card for the product, with the same allergy check a
 * scan gets; nothing is logged until the user taps the card.
 *
 * No AI model is called: the camera decodes the number on the phone and the
 * product comes from the barcode lookup. So this route needs no AI consent
 * and spends no photo credit. It is still a Coach turn (daily message limit),
 * still Coach Pro's because the reply is a write card, and has its own daily
 * scan count.
 */
import type { Express, Request, Response } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { storage } from "../storage";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { logger, toError } from "../lib/logger";
import { rejectOverlappingChatTurn } from "../lib/in-flight";
import { parseTimezone } from "../lib/civil-date";
import { ErrorCode } from "@shared/constants/error-codes";
import { isValidBarcode } from "@shared/constants/classification";
import { AI_DAILY_CAPS } from "@shared/types/premium";
import {
  handleRouteError,
  checkPremiumFeature,
  parsePositiveIntParam,
  formatZodError,
} from "./_helpers";
import { saveOpeningBrief } from "./chat-admit";
import { ipKeyGenerator, resolveRateLimitMax } from "./_rate-limiters";
import { CONVERSATION_CONFIG } from "../services/chat-turn";
import { isRecipeOfferEnabled } from "../services/recipe-finder";
import {
  scannedBarcodeReply,
  photoCardProposal,
  BARCODE_LOOKUP_DOWN_TEXT,
  COACH_BARCODE_USER_TEXT,
} from "../services/coach-photo";
import { createWriteCardBlock } from "../services/coach-pro-chat/write-card-context";
import type { CoachBlock } from "@shared/schemas/coach-blocks";

const SCAN_CAP_TEXT =
  "You've reached today's scan limit. Tell me what you ate and I'll log it for you.";
const CARD_FAILED_TEXT =
  "I found the product but couldn't make the card just now. Please scan it again.";

const bodySchema = z
  .object({
    // The shapes the app's scanner sends (UPC-E, EAN-8, UPC-A, EAN-13). The
    // phone's decoder has already checked the symbol's own checksum.
    barcode: z.string().refine(isValidBarcode, "Invalid barcode"),
    // Which opening brief the new chat showed, as on a typed first message.
    openingBrief: z.enum(["full", "short"]).optional(),
  })
  .strict();

export function register(app: Express): void {
  app.post(
    "/api/chat/conversations/:id/barcode",
    requireAuth,
    // Inline, not a factory const: CodeQL's js/missing-rate-limiting query
    // cannot trace the factory. Same limits as the Scan screen's barcode
    // lookup: 15/min, keyed by user with the IP fallback.
    rateLimit({
      windowMs: 60 * 1000,
      max: resolveRateLimitMax(15, process.env),
      message: {
        error: "Too many scans. Please wait.",
        code: ErrorCode.RATE_LIMITED,
      },
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req: Request) => req.userId || ipKeyGenerator(req),
    }),
    rejectOverlappingChatTurn,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const id = parsePositiveIntParam(req.params.id);
        if (!id)
          return sendError(
            res,
            400,
            "Invalid conversation ID",
            ErrorCode.VALIDATION_ERROR,
          );

        const body = bodySchema.safeParse(req.body ?? {});
        if (!body.success)
          return sendError(
            res,
            400,
            formatZodError(body.error),
            ErrorCode.VALIDATION_ERROR,
          );

        const conversation = await storage.getChatConversation(id, req.userId);
        if (!conversation)
          return sendError(
            res,
            404,
            "Conversation not found",
            ErrorCode.NOT_FOUND,
          );
        if (conversation.type === "recipe" || conversation.type === "remix")
          return sendError(
            res,
            400,
            "Barcodes can only be sent to the Coach",
            ErrorCode.VALIDATION_ERROR,
          );

        // The reply is a write card, and write cards are Coach Pro's.
        const features = await checkPremiumFeature(
          req,
          res,
          "coachPro",
          "Scanning in Coach chat",
        );
        if (!features) return;

        if (body.data.openingBrief) {
          await saveOpeningBrief(req, id, features, body.data.openingBrief);
        }

        // A scan is a Coach turn: it counts toward the daily message limit,
        // checked and stored atomically like a typed message (chat-admit.ts).
        const dailyLimit = CONVERSATION_CONFIG.coach.dailyLimit(features);
        const userMessage = isRecipeOfferEnabled()
          ? await storage.createChatMessageWithLimitCheck(
              id,
              req.userId,
              COACH_BARCODE_USER_TEXT,
              dailyLimit,
              "coach",
              { excludeFinderTaps: true },
            )
          : await storage.createChatMessageWithLimitCheck(
              id,
              req.userId,
              COACH_BARCODE_USER_TEXT,
              dailyLimit,
              "coach",
            );
        if (!userMessage)
          return sendError(
            res,
            429,
            CONVERSATION_CONFIG.coach.limitMessage(features),
            ErrorCode.DAILY_LIMIT_REACHED,
          );

        // The user's turn is stored, so every outcome from here answers it
        // in the conversation rather than leaving a question with no reply.
        const tz = parseTimezone(req.headers["x-timezone"]);
        let text = BARCODE_LOOKUP_DOWN_TEXT;
        let blocks: CoachBlock[] = [];
        try {
          // Claimed last: a turn refused above (message limit) spends none.
          const claimed = await storage.claimDailyAiCall(
            req.userId,
            "coachBarcodeScan",
            AI_DAILY_CAPS.coachBarcodeScan,
          );
          if (!claimed) {
            text = SCAN_CAP_TEXT;
          } else {
            const reply = await scannedBarcodeReply(body.data.barcode, {
              tz,
              now: new Date(),
              userId: req.userId,
            });
            const { payload } = reply;
            const card = payload
              ? await createWriteCardBlock(
                  photoCardProposal(payload),
                  { conversationId: id, userId: req.userId, tz },
                  payload,
                )
              : null;
            if (card) blocks = [card];
            text = payload && !card ? CARD_FAILED_TEXT : reply.text;
          }
        } catch (err) {
          logger.error({ err: toError(err) }, "coach barcode lookup failed");
        }

        const assistantMessage = await storage.createChatMessage(
          id,
          req.userId,
          "assistant",
          text,
          blocks.length > 0 ? { blocks } : null,
        );
        res.status(201).json({ userMessage, assistantMessage });
      } catch (error) {
        handleRouteError(res, error, "send coach barcode");
      }
    },
  );
}
