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
} from "../services/chat-turn";
import { endSseQuietly } from "../lib/sse";
import { parseTimezone } from "../lib/civil-date";
import { logger } from "../lib/logger";
import { buildCoachBrief } from "../services/coach-brief";
import {
  OPENING_BRIEF_METADATA,
  type BriefForm,
} from "@shared/lib/opening-brief";

export interface AdmitTurnArgs {
  req: AuthenticatedRequest;
  res: Response;
  conversationId: number;
  conversationType: ConversationType;
  features: TurnFeatures;
  sanitizedContent: string;
  finderAction: z.infer<typeof finderActionSchema> | undefined;
  /** First send from a new coach chat that showed the opening brief. */
  openingBrief?: BriefForm;
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
  openingBrief,
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
        endSseQuietly(res);
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
        endSseQuietly(res);
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
          endSseQuietly(res);
          return null;
        }
        message = created.message;
      }
    }
  }

  if (!message) {
    // Rendered now, saved by the limit check below in its own transaction.
    const brief =
      openingBrief && conversationType === "coach" && !finderAction
        ? await prepareOpeningBrief(req, id, features, openingBrief)
        : undefined;
    // Atomically check daily limit and create message in a single
    // transaction to prevent TOCTOU races bypassing the limit.
    const dailyLimit = config.dailyLimit(features);
    // Offer flag on: only typed Coach messages count toward the daily
    // limit — finder tap rows (finderInput) are left out of the count.
    message = await storage.createChatMessageWithLimitCheck(
      id,
      req.userId,
      sanitizedContent,
      dailyLimit,
      conversationType,
      ...limitCheckOptions(offerEnabled && conversationType === "coach", brief),
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

export interface OpeningBriefRow {
  content: string;
  metadata: Record<string, unknown>;
}

/**
 * Render the opening brief for the conversation's first (assistant) message,
 * so the coach sees what it "said". The text is re-rendered here from the
 * user's own data — the client only says which form it showed and never
 * supplies assistant text. The limit check saves it (`limitCheckOptions`),
 * in the same transaction as the user's message, and clears the reminders
 * with it: saved here, a 429 left an orphan brief and the reminders gone
 * (audit 2026-11-24, L98). Undefined for a conversation that already has
 * messages; a failure is logged and the message goes through without it.
 */
export async function prepareOpeningBrief(
  req: AuthenticatedRequest,
  conversationId: number,
  features: TurnFeatures,
  form: BriefForm,
): Promise<OpeningBriefRow | undefined> {
  try {
    // Cheap skip; the limit check repeats it inside its transaction.
    const existing = await storage.getChatMessages(
      conversationId,
      1,
      req.userId,
    );
    if (existing.length > 0) return undefined;
    const brief = await buildCoachBrief(
      req.userId,
      features,
      parseTimezone(req.headers?.["x-timezone"]),
      form,
    );
    return { content: brief.text, metadata: { ...OPENING_BRIEF_METADATA } };
  } catch (err) {
    logger.warn({ err, conversationId }, "opening brief not saved");
    return undefined;
  }
}

/** The limit check's optional last argument, left out when it is empty. */
export function limitCheckOptions(
  excludeFinderTaps: boolean,
  openingBrief: OpeningBriefRow | undefined,
): [] | [{ excludeFinderTaps?: true; openingBrief?: OpeningBriefRow }] {
  if (!excludeFinderTaps && !openingBrief) return [];
  return [
    {
      ...(excludeFinderTaps && { excludeFinderTaps: true as const }),
      ...(openingBrief && { openingBrief }),
    },
  ];
}
