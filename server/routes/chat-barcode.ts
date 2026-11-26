/**
 * Turns the phone read itself, sent into the Coach chat:
 *
 * - POST /api/chat/conversations/:id/barcode — a barcode the app's camera
 *   decoded. The product comes from the barcode lookup, with the same allergy
 *   check a scan gets.
 * - POST /api/chat/conversations/:id/label — a nutrition label the app's text
 *   reader read from a photo (Coach roadmap V5). The photo stays on the
 *   phone; only the numbers are sent.
 *
 * Either way the reply is a stored assistant message carrying a one-serving
 * food log card; nothing is logged until the user taps the card.
 *
 * No AI model is called, so these routes need no AI consent and spend no
 * photo credit. Each is still a Coach turn (daily message limit), still Coach
 * Pro's because the reply is a write card, and has its own daily count.
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
import { AI_DAILY_CAPS, type AiCallKind } from "@shared/types/premium";
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
  scannedLabelReply,
  photoCardProposal,
  BARCODE_LOOKUP_DOWN_TEXT,
  COACH_BARCODE_USER_TEXT,
  COACH_PHOTO_USER_TEXT,
  type PhotoReply,
} from "../services/coach-photo";
import { createWriteCardBlock } from "../services/coach-pro-chat/write-card-context";
import type { CoachBlock } from "@shared/schemas/coach-blocks";

const SCAN_CAP_TEXT =
  "You've reached today's scan limit. Tell me what you ate and I'll log it for you.";
const CARD_FAILED_TEXT =
  "I found the product but couldn't make the card just now. Please scan it again.";
const LABEL_FAILED_TEXT =
  "I couldn't make a card from that label just now. Please send it again.";
const LABEL_CARD_FAILED_TEXT =
  "I read your label but couldn't make the card just now. Please send it again.";

// Which opening brief the new chat showed, as on a typed first message.
const openingBrief = z.enum(["full", "short"]).optional();

const barcodeBodySchema = z
  .object({
    // The shapes the app's scanner sends (UPC-E, EAN-8, UPC-A, EAN-13). The
    // phone's decoder has already checked the symbol's own checksum.
    barcode: z.string().refine(isValidBarcode, "Invalid barcode"),
    openingBrief,
  })
  .strict();

// The app's label parser reads no value above 10,000; the food card's own,
// tighter limits are applied when the card is made.
const amount = z.number().finite().min(0).max(10000);
const labelBodySchema = z
  .object({
    label: z
      .object({
        calories: amount,
        protein: amount,
        carbs: amount,
        fat: amount,
        servingSize: z.string().trim().min(1).max(100),
      })
      .strict(),
    openingBrief,
  })
  .strict();

interface PhoneReadTurn {
  /** What the stored user turn says. */
  userText: string;
  /** The turn's own daily count. */
  capKind: AiCallKind;
  /** The premium gate's wording. */
  featureName: string;
  /** Said when the reply could not be made at all. */
  failedText: string;
  /** Said when the card was read but could not be stored. */
  cardFailedText: string;
  /** For the wrong-chat refusal ("Barcodes can only be sent to the Coach"). */
  noun: string;
  logLabel: string;
  reply: (ctx: {
    tz: string;
    now: Date;
    userId: string;
  }) => Promise<PhotoReply>;
}

/** Everything after the body is read: the chat, the plan, the limits, the card. */
async function answerPhoneRead(
  req: AuthenticatedRequest,
  res: Response,
  brief: "full" | "short" | undefined,
  turn: PhoneReadTurn,
): Promise<void> {
  const id = parsePositiveIntParam(req.params.id);
  if (!id)
    return sendError(
      res,
      400,
      "Invalid conversation ID",
      ErrorCode.VALIDATION_ERROR,
    );

  const conversation = await storage.getChatConversation(id, req.userId);
  if (!conversation)
    return sendError(res, 404, "Conversation not found", ErrorCode.NOT_FOUND);
  if (conversation.type === "recipe" || conversation.type === "remix")
    return sendError(
      res,
      400,
      `${turn.noun} can only be sent to the Coach`,
      ErrorCode.VALIDATION_ERROR,
    );

  // The reply is a write card, and write cards are Coach Pro's.
  const features = await checkPremiumFeature(
    req,
    res,
    "coachPro",
    turn.featureName,
  );
  if (!features) return;

  if (brief) await saveOpeningBrief(req, id, features, brief);

  // A Coach turn: it counts toward the daily message limit, checked and
  // stored atomically like a typed message (chat-admit.ts).
  const dailyLimit = CONVERSATION_CONFIG.coach.dailyLimit(features);
  const userMessage = isRecipeOfferEnabled()
    ? await storage.createChatMessageWithLimitCheck(
        id,
        req.userId,
        turn.userText,
        dailyLimit,
        "coach",
        { excludeFinderTaps: true },
      )
    : await storage.createChatMessageWithLimitCheck(
        id,
        req.userId,
        turn.userText,
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

  // The user's turn is stored, so every outcome from here answers it in the
  // conversation rather than leaving a question with no reply.
  const tz = parseTimezone(req.headers["x-timezone"]);
  let text = turn.failedText;
  let blocks: CoachBlock[] = [];
  try {
    // Claimed last: a turn refused above (message limit) spends none.
    const claimed = await storage.claimDailyAiCall(
      req.userId,
      turn.capKind,
      AI_DAILY_CAPS[turn.capKind],
    );
    if (!claimed) {
      text = SCAN_CAP_TEXT;
    } else {
      const reply = await turn.reply({
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
      text = payload && !card ? turn.cardFailedText : reply.text;
    }
  } catch (err) {
    logger.error({ err: toError(err) }, `coach ${turn.logLabel} failed`);
  }

  const assistantMessage = await storage.createChatMessage(
    id,
    req.userId,
    "assistant",
    text,
    blocks.length > 0 ? { blocks } : null,
  );
  res.status(201).json({ userMessage, assistantMessage });
}

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
        const body = barcodeBodySchema.safeParse(req.body ?? {});
        if (!body.success)
          return sendError(
            res,
            400,
            formatZodError(body.error),
            ErrorCode.VALIDATION_ERROR,
          );
        const { barcode } = body.data;
        await answerPhoneRead(req, res, body.data.openingBrief, {
          userText: COACH_BARCODE_USER_TEXT,
          capKind: "coachBarcodeScan",
          featureName: "Scanning in Coach chat",
          failedText: BARCODE_LOOKUP_DOWN_TEXT,
          cardFailedText: CARD_FAILED_TEXT,
          noun: "Barcodes",
          logLabel: "barcode lookup",
          reply: (ctx) => scannedBarcodeReply(barcode, ctx),
        });
      } catch (error) {
        handleRouteError(res, error, "send coach barcode");
      }
    },
  );

  app.post(
    "/api/chat/conversations/:id/label",
    requireAuth,
    // Inline for CodeQL, as above. The photo route's limit: 10/min.
    rateLimit({
      windowMs: 60 * 1000,
      max: resolveRateLimitMax(10, process.env),
      message: {
        error: "Too many photo uploads. Please wait.",
        code: ErrorCode.RATE_LIMITED,
      },
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req: Request) => req.userId || ipKeyGenerator(req),
    }),
    rejectOverlappingChatTurn,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const body = labelBodySchema.safeParse(req.body ?? {});
        if (!body.success)
          return sendError(
            res,
            400,
            formatZodError(body.error),
            ErrorCode.VALIDATION_ERROR,
          );
        const { label } = body.data;
        await answerPhoneRead(req, res, body.data.openingBrief, {
          // The user sent a photo; the phone read it.
          userText: COACH_PHOTO_USER_TEXT,
          capKind: "coachLabelRead",
          featureName: "Photos in Coach chat",
          failedText: LABEL_FAILED_TEXT,
          cardFailedText: LABEL_CARD_FAILED_TEXT,
          noun: "Photos",
          logLabel: "phone label read",
          reply: (ctx) => scannedLabelReply(label, ctx),
        });
      } catch (error) {
        handleRouteError(res, error, "send coach label");
      }
    },
  );
}
