/**
 * Turn admission for POST /api/chat/conversations/:id/messages — the recipe
 * finder entry rules and the TOCTOU-safe daily quota. Extracted from `chat.ts`
 * (pure move). Imports siblings directly, never `./chat`.
 */
import type { Response } from "express";
import type { z } from "zod";
import { storage } from "../storage";
import type { AuthenticatedRequest } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import type { ChatMessage } from "@shared/schema";
import type { finderActionSchema } from "@shared/schemas/recipe-finder";
import {
  isRecipeFinderEnabled,
  isRecipeOfferEnabled,
  decideRecipeChefEntry,
  getLatestFinderBlock,
  isActionCurrent,
  classifyTurn,
  type FinderInput,
} from "../services/recipe-finder";
import {
  CONVERSATION_CONFIG,
  type ConversationType,
  type TurnFeatures,
  type TurnInput,
} from "./chat-stream";

/** A no-op turn (stale or repeated finder action): open and close the SSE. */
function endQuietly(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  res.end();
}

export interface AdmitTurnArgs {
  req: AuthenticatedRequest;
  res: Response;
  conversationId: number;
  conversationType: ConversationType;
  features: TurnFeatures;
  sanitizedContent: string;
  finderAction: z.infer<typeof finderActionSchema> | undefined;
}

/**
 * Admit a turn: recipe-finder entry rules and the daily quota. Returns the
 * stored user message (plus the finder state the stream needs), or null when
 * the response was already sent (409 / quiet no-op / 429).
 */
export async function admitTurn({
  req,
  res,
  conversationId: id,
  conversationType,
  features,
  sanitizedContent,
  finderAction,
}: AdmitTurnArgs): Promise<Pick<
  TurnInput,
  | "userMessage"
  | "finderEnabled"
  | "offerEnabled"
  | "finderHistory"
  | "recipeFinderInput"
> | null> {
  const isRecipeChat = conversationType === "recipe";
  const isRemixChat = conversationType === "remix";
  const config = CONVERSATION_CONFIG[conversationType];
  const finderEnabled = isRecipeFinderEnabled();
  const offerEnabled = isRecipeOfferEnabled();
  if (
    finderAction &&
    (!finderEnabled || isRemixChat || (!isRecipeChat && !features.coachPro))
  ) {
    sendError(
      res,
      409,
      "Recipe finder isn't available right now.",
      ErrorCode.CONFLICT,
    );
    return null;
  }

  // ─── RECIPE FINDER ENTRY (flag on) ───────────────────
  // Must run BEFORE createChatMessageWithLimitCheck: that check counts
  // every recipe-chat user row as a generation (R2 quota trap). Finder
  // rows go through createFinderUserMessage (never counted); only a
  // Generate step claims a generation (executeFinderStep).
  let message: ChatMessage | null = null;
  let finderHistory: ChatMessage[] = [];
  let recipeFinderInput: FinderInput | null = null;
  if (finderEnabled && (finderAction || isRecipeChat)) {
    finderHistory = await storage.getChatMessages(id, 20, req.userId);
    if (finderAction) {
      // Stale (an older list's button) → quiet no-op, before any row.
      if (!isActionCurrent(getLatestFinderBlock(finderHistory), finderAction)) {
        endQuietly(res);
        return null;
      }
      const created = await storage.createFinderUserMessage(
        id,
        req.userId,
        sanitizedContent,
        {
          action: {
            flowId: finderAction.flowId,
            type: finderAction.type,
          },
          // Offer flag on: Coach finder taps (offer/card/list buttons)
          // don't count toward the Coach Pro daily message limit.
          ...(isRecipeChat || offerEnabled
            ? {}
            : { coachDailyLimit: features.coachProDailyMessages }),
        },
      );
      // Double tap: the same flowId already has a row → quiet no-op.
      if (created.status === "duplicate") {
        endQuietly(res);
        return null;
      }
      if (created.status === "limit_reached") {
        sendError(
          res,
          429,
          "Daily Coach Pro message limit reached",
          ErrorCode.DAILY_LIMIT_REACHED,
        );
        return null;
      }
      message = created.message;
      if (isRecipeChat) {
        recipeFinderInput = { kind: "action", action: finderAction };
      }
    } else {
      // RecipeChef typed turn (§3.3). Remix never gets here.
      const entry = decideRecipeChefEntry(finderHistory, sanitizedContent, {
        offer: offerEnabled,
      });
      if (entry.kind === "finder") {
        recipeFinderInput = entry.input;
      } else if (entry.kind === "classify") {
        const turn = await classifyTurn(sanitizedContent, entry.recipeTitle);
        if (turn === "new_request") {
          recipeFinderInput = { kind: "start", text: sanitizedContent };
        }
      }
      if (recipeFinderInput) {
        const created = await storage.createFinderUserMessage(
          id,
          req.userId,
          sanitizedContent,
        );
        if (created.status !== "created") {
          endQuietly(res);
          return null;
        }
        message = created.message;
      }
    }
  }

  if (!message) {
    // Atomically check daily limit and create message in a single
    // transaction to prevent TOCTOU races bypassing the limit.
    const dailyLimit = config.dailyLimit(features);
    // Offer flag on: only typed Coach messages count toward the daily
    // limit — finder tap rows (finderInput) are left out of the count.
    message =
      offerEnabled && conversationType === "coach"
        ? await storage.createChatMessageWithLimitCheck(
            id,
            req.userId,
            sanitizedContent,
            dailyLimit,
            conversationType,
            { excludeFinderTaps: true },
          )
        : await storage.createChatMessageWithLimitCheck(
            id,
            req.userId,
            sanitizedContent,
            dailyLimit,
            conversationType,
          );
    if (!message) {
      sendError(
        res,
        429,
        config.limitMessage(features),
        ErrorCode.DAILY_LIMIT_REACHED,
      );
      return null;
    }
  }
  return {
    userMessage: message,
    finderEnabled,
    offerEnabled,
    finderHistory,
    recipeFinderInput,
  };
}
