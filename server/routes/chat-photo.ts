/**
 * POST /api/chat/conversations/:id/photo — a meal photo sent into the Coach
 * chat (Coach roadmap S1). The reply is a stored assistant message carrying a
 * food log card; nothing is logged until the user taps the card. The photo
 * is analyzed in memory and never stored.
 */
import type { Express, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { logger, toError } from "../lib/logger";
import { parseTimezone } from "../lib/civil-date";
import { ErrorCode } from "@shared/constants/error-codes";
import {
  handleRouteError,
  checkPremiumFeature,
  checkAiConfigured,
  checkAiSharing,
  parsePositiveIntParam,
  requireValidImage,
  formatZodError,
} from "./_helpers";
import { AI_DAILY_CAPS } from "@shared/types/premium";
import { saveOpeningBrief } from "./chat-admit";
import { photoRateLimit } from "./_rate-limiters";
import { upload } from "./_upload";
import { CONVERSATION_CONFIG } from "../services/chat-turn";
import { isRecipeOfferEnabled } from "../services/recipe-finder";
import {
  buildPhotoFoodCard,
  photoCardProposal,
  photoReplyText,
  COACH_PHOTO_USER_TEXT,
} from "../services/coach-photo";
import { createWriteCardBlock } from "../services/coach-pro-chat/write-card-context";
import type { CoachBlock } from "@shared/schemas/coach-blocks";

const ANALYSIS_FAILED_TEXT =
  "I couldn't read that photo just now. Please try again in a moment.";
const PHOTO_CAP_TEXT =
  "You've reached today's photo limit. Tell me what you ate and I'll log it for you.";

// The one non-file form field (server/routes/_upload.ts allows exactly one):
// which opening brief the new chat showed, as on a typed first message.
const fieldsSchema = z.object({
  openingBrief: z.enum(["full", "short"]).optional(),
});

export function register(app: Express): void {
  app.post(
    "/api/chat/conversations/:id/photo",
    requireAuth,
    photoRateLimit,
    upload.single("photo"),
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
            "Photos can only be sent to the Coach",
            ErrorCode.VALIDATION_ERROR,
          );

        const fields = fieldsSchema.safeParse(req.body ?? {});
        if (!fields.success)
          return sendError(
            res,
            400,
            formatZodError(fields.error),
            ErrorCode.VALIDATION_ERROR,
          );

        if (!checkAiConfigured(res)) return;
        if (!(await checkAiSharing(req, res))) return;

        // The reply is a write card, and write cards are Coach Pro's.
        const features = await checkPremiumFeature(
          req,
          res,
          "coachPro",
          "Photos in Coach chat",
        );
        if (!features) return;
        if (!features.photoAnalysis)
          return sendError(
            res,
            403,
            "Photo analysis requires a premium subscription",
            ErrorCode.PREMIUM_REQUIRED,
          );

        const imageBase64 = requireValidImage(req, res);
        if (!imageBase64) return;

        if (fields.data.openingBrief) {
          await saveOpeningBrief(req, id, features, fields.data.openingBrief);
        }

        // A photo is a Coach turn: it counts toward the daily message limit,
        // checked and stored atomically like a typed message (chat-admit.ts).
        const dailyLimit = CONVERSATION_CONFIG.coach.dailyLimit(features);
        const userMessage = isRecipeOfferEnabled()
          ? await storage.createChatMessageWithLimitCheck(
              id,
              req.userId,
              COACH_PHOTO_USER_TEXT,
              dailyLimit,
              "coach",
              { excludeFinderTaps: true },
            )
          : await storage.createChatMessageWithLimitCheck(
              id,
              req.userId,
              COACH_PHOTO_USER_TEXT,
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
        let text = ANALYSIS_FAILED_TEXT;
        let blocks: CoachBlock[] = [];
        try {
          // Same daily cap as the Scan screen's analysis, claimed last: a
          // turn refused above (message limit) must not spend a photo credit.
          const claimed = await storage.claimDailyAiCall(
            req.userId,
            "photoAnalysis",
            AI_DAILY_CAPS.photoAnalysis,
          );
          if (!claimed) {
            text = PHOTO_CAP_TEXT;
          } else {
            const { payload, skipped } = await buildPhotoFoodCard(imageBase64, {
              tz,
              now: new Date(),
            });
            const card = payload
              ? await createWriteCardBlock(
                  photoCardProposal(payload),
                  { conversationId: id, userId: req.userId, tz },
                  payload,
                )
              : null;
            if (card) blocks = [card];
            // A card that could not be stored reads as "nothing to show".
            const shown = card ? (payload?.items.length ?? 0) : 0;
            text = photoReplyText(shown, skipped);
          }
        } catch (err) {
          logger.error({ err: toError(err) }, "coach photo analysis failed");
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
        handleRouteError(res, error, "send coach photo");
      }
    },
  );
}
