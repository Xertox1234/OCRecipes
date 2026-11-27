import type { Express, Request, Response } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { storage } from "../storage";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import {
  formatZodError,
  handleRouteError,
  parsePositiveIntParam,
  parseQueryInt,
  checkPremiumFeature,
  checkAiConfigured,
  checkAiSharing,
} from "./_helpers";
import {
  chatRateLimit,
  chatReadRateLimit,
  ipKeyGenerator,
  resolveRateLimitMax,
} from "./_rate-limiters";
import { CHAT_MESSAGE_REPORT_REASON_IDS } from "@shared/constants/chat-message-report";
import { fireAndForget } from "../lib/fire-and-forget";
import { sendError } from "../lib/api-errors";
import { rejectOverlappingChatTurn } from "../lib/in-flight";
import { ErrorCode } from "@shared/constants/error-codes";
import { logger, toError } from "../lib/logger";
import { tryArchiveNotebook } from "../services/coach-pro-chat";
import { sanitizeUserInput } from "../lib/ai-safety";
import { finderActionSchema } from "@shared/schemas/recipe-finder";
import { enrichWriteCardBlocks } from "../services/write-cards/enrich";
import {
  ConversationLimitError,
  MAX_CONVERSATIONS_PER_USER,
} from "../storage/chat-errors";
import { parseTimezone } from "../lib/civil-date";
import { admitTurn } from "./chat-admit";
import {
  CONVERSATION_CONFIG,
  runTurn,
  type ConversationType,
} from "../services/chat-turn";

/** GET /api/chat/conversations query: no type lists every kind. */
const listQuerySchema = z.object({
  type: z.enum(["coach", "recipe", "remix"]).optional(),
  // Cut, not refused: the app's search box has no length limit.
  search: z
    .string()
    .transform((s) => s.slice(0, 200))
    .optional(),
});

/**
 * Card kinds beyond the first three that an app can declare (spec
 * 2026-11-16). The list's own length caps the array, so a new kind can't
 * leave the cap a step behind.
 */
const CARD_KINDS = [
  "pantry",
  "goals",
  "allergy",
  "plan_shop",
  "quick_log",
  "day_progress",
  "week_progress",
  "more_charts",
  "label_compare",
  "weekly_report",
  "reminders",
] as const;

export function register(app: Express): void {
  // GET /api/chat/conversations - List conversations
  app.get(
    "/api/chat/conversations",
    requireAuth,
    chatReadRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const limit = parseQueryInt(req.query.limit, { default: 20, max: 50 });
        const page = parseQueryInt(req.query.page, {
          default: 1,
          min: 1,
          max: 100,
        });
        // Parsed, not cast: a mistyped type listed every kind, and the search
        // text had no limit (audit 2026-11-24, L42).
        const parsed = listQuerySchema.safeParse({
          type: req.query.type,
          search: req.query.search,
        });
        if (!parsed.success)
          return sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
        const { type } = parsed.data;
        const search = parsed.data.search?.trim();
        const conversations = await storage.getChatConversations(
          req.userId,
          limit,
          type,
          { search, page },
        );
        res.json(conversations);
      } catch (error) {
        handleRouteError(res, error, "list conversations");
      }
    },
  );

  // GET /api/chat/conversations/:id - Get single conversation with message count
  app.get(
    "/api/chat/conversations/:id",
    requireAuth,
    chatReadRateLimit,
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

        const messageCount = await storage.getChatMessageCount(id, req.userId);
        res.json({
          ...conversation,
          messageCount,
          nearLimit: messageCount > 500,
        });
      } catch (error) {
        handleRouteError(res, error, "fetch conversation");
      }
    },
  );

  // POST /api/chat/conversations - Create conversation
  app.post(
    "/api/chat/conversations",
    requireAuth,
    chatRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const schema = z.object({
          title: z.string().max(200).optional(),
          type: z.enum(["coach", "recipe", "remix"]).default("coach"),
          sourceRecipeId: z.int32().positive().optional(),
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success)
          return sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );

        // Remix conversations require a source recipe
        let conversationMetadata: Record<string, unknown> | null = null;
        let defaultTitle =
          parsed.data.type === "recipe" ? "New Recipe Chat" : "New Chat";
        let remixSourceRecipe: Awaited<
          ReturnType<typeof storage.getCommunityRecipe>
        > = undefined;

        if (parsed.data.type === "remix") {
          if (!parsed.data.sourceRecipeId) {
            return sendError(
              res,
              400,
              "sourceRecipeId is required for remix conversations",
              ErrorCode.VALIDATION_ERROR,
            );
          }

          // Fetch source recipe to validate it exists and is accessible.
          // Storage scopes by visibility/ownership: a private recipe the user
          // does not own resolves to undefined (no existence leak).
          remixSourceRecipe = await storage.getCommunityRecipe(
            parsed.data.sourceRecipeId,
            req.userId,
          );
          if (!remixSourceRecipe) {
            return sendError(
              res,
              404,
              "Source recipe not found",
              ErrorCode.NOT_FOUND,
            );
          }

          // Defense in depth: storage already scopes by visibility/ownership,
          // but re-check at the route boundary so a future storage regression
          // cannot leak a private recipe the user does not own.
          if (
            !remixSourceRecipe.isPublic &&
            remixSourceRecipe.authorId !== req.userId
          ) {
            return sendError(
              res,
              404,
              "Source recipe not found",
              ErrorCode.NOT_FOUND,
            );
          }

          conversationMetadata = {
            sourceRecipeId: remixSourceRecipe.id,
            sourceRecipeTitle: remixSourceRecipe.title,
          };
          defaultTitle = `Remix: ${remixSourceRecipe.title}`;
        }

        const conversation = await storage.createChatConversation(
          req.userId,
          parsed.data.title || defaultTitle,
          parsed.data.type,
          conversationMetadata,
        );

        // For remix conversations, insert the source recipe as a system message.
        // Reuses remixSourceRecipe fetched above — no duplicate DB query.
        if (remixSourceRecipe) {
          await storage.createChatMessage(
            conversation.id,
            req.userId,
            "system",
            JSON.stringify({
              title: remixSourceRecipe.title,
              description: remixSourceRecipe.description,
              difficulty: remixSourceRecipe.difficulty,
              timeEstimate: remixSourceRecipe.timeEstimate,
              servings: remixSourceRecipe.servings,
              ingredients: remixSourceRecipe.ingredients,
              instructions: remixSourceRecipe.instructions,
              dietTags: remixSourceRecipe.dietTags,
            }),
          );
        }

        res.status(201).json(conversation);
      } catch (error) {
        if (error instanceof ConversationLimitError) {
          return sendError(
            res,
            409,
            `You have ${MAX_CONVERSATIONS_PER_USER.toLocaleString("en-US")} chats, the most allowed. Delete some to start a new one.`,
            ErrorCode.LIMIT_REACHED,
          );
        }
        handleRouteError(res, error, "create conversation");
      }
    },
  );

  // GET /api/chat/conversations/:id/messages - Get messages
  app.get(
    "/api/chat/conversations/:id/messages",
    requireAuth,
    chatReadRateLimit,
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

        // The saved timezone decides when a food card's day is over (audit
        // 2026-11-24, L107); this request carries none.
        const messages = await enrichWriteCardBlocks(
          await storage.getChatMessages(id, 100, req.userId),
          req.userId,
          async () => {
            const savedTz = (await storage.getUser(req.userId))?.timezone;
            return savedTz ? parseTimezone(savedTz) : null;
          },
        );
        fireAndForget(
          "coach-notebook-archival",
          tryArchiveNotebook(req.userId),
        );
        res.json(messages);
      } catch (error) {
        handleRouteError(res, error, "fetch messages");
      }
    },
  );

  // POST /api/chat/conversations/:id/messages - Send message + stream response
  app.post(
    "/api/chat/conversations/:id/messages",
    requireAuth,
    chatRateLimit,
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

        const conversation = await storage.getChatConversation(id, req.userId);
        if (!conversation)
          return sendError(
            res,
            404,
            "Conversation not found",
            ErrorCode.NOT_FOUND,
          );

        const schema = z.object({
          content: z.string().min(1).max(2000),
          // Cut, not refused: the recipe screen sends every ingredient name
          // uncapped, and a 400 lost the whole question (audit 2026-11-24,
          // L41). Downstream trims it further per use.
          screenContext: z
            .string()
            .transform((s) => s.slice(0, 1500))
            .optional(),
          warmUpId: z.string().max(100).optional(),
          turnKey: z.string().uuid().optional(),
          // Recipe finder button taps (R2): structured, never parsed from
          // `content`, and never from route params (#1147/#1148).
          finderAction: finderActionSchema.optional(),
          // First send from a new coach chat that showed the opening brief:
          // only WHICH form was shown. The server re-renders and saves the
          // brief itself; the client never supplies assistant text.
          openingBrief: z.enum(["full", "short"]).optional(),
          // Coach write cards (spec 2026-11-09): the app can show them, and
          // the card on screen with the user's edits. Only edits — the
          // server never takes numbers or ids from here.
          writeCards: z.literal(true).optional(),
          // Card kinds added after the first three (spec 2026-11-16). An app
          // that cannot draw a kind does not list it, and the coach is then
          // never given the tool that makes that card.
          cardKinds: z
            .array(z.enum(CARD_KINDS))
            .max(CARD_KINDS.length)
            .optional(),
          liveCard: z
            .object({
              cardId: z.string().uuid(),
              edits: z.record(z.string(), z.unknown()),
            })
            .strict()
            .optional(),
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success)
          return sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );

        // Premium gate — fail fast before DB queries
        if (!checkAiConfigured(res)) return;
        if (!(await checkAiSharing(req, res))) return;

        // Dispatch based on conversation type
        const conversationType: ConversationType =
          conversation.type === "remix"
            ? "remix"
            : conversation.type === "recipe"
              ? "recipe"
              : "coach";
        const config = CONVERSATION_CONFIG[conversationType];
        const features = await checkPremiumFeature(
          req,
          res,
          config.featureKey,
          config.featureLabel,
        );
        if (!features) return;

        const user = await storage.getUser(req.userId);
        if (!user)
          return sendError(res, 401, "Unauthorized", ErrorCode.UNAUTHORIZED);

        const sanitizedContent = sanitizeUserInput(parsed.data.content);
        // "   " passes min(1) but sanitizes to "" — a finder flow built on it
        // stores a request its own schema rejects, leaving a dead list.
        if (!sanitizedContent) {
          return sendError(
            res,
            400,
            "Message can't be empty",
            ErrorCode.VALIDATION_ERROR,
          );
        }
        const admitted = await admitTurn({
          req,
          res,
          conversationId: id,
          conversationType,
          features,
          sanitizedContent,
          finderAction: parsed.data.finderAction,
          openingBrief: parsed.data.openingBrief,
        });
        if (!admitted) return;

        await runTurn({
          req,
          res,
          conversationId: id,
          conversation,
          conversationType,
          features,
          user,
          sanitizedContent,
          body: parsed.data,
          finderAction: parsed.data.finderAction,
          ...admitted,
        });
      } catch (error) {
        if (!res.headersSent) {
          handleRouteError(res, error, "send message");
        } else {
          logger.error({ err: toError(error) }, "send message error");
        }
      }
    },
  );

  // DELETE /api/chat/conversations/:id - Delete conversation
  app.delete(
    "/api/chat/conversations/:id",
    requireAuth,
    chatRateLimit,
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

        const deleted = await storage.deleteChatConversation(id, req.userId);
        if (!deleted)
          return sendError(
            res,
            404,
            "Conversation not found",
            ErrorCode.NOT_FOUND,
          );
        res.status(204).send();
      } catch (error) {
        handleRouteError(res, error, "delete conversation");
      }
    },
  );

  // PATCH /api/chat/conversations/:id/pin
  const pinSchema = z.object({ isPinned: z.boolean() });

  app.patch(
    "/api/chat/conversations/:id/pin",
    requireAuth,
    chatRateLimit,
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
        const parsed = pinSchema.safeParse(req.body);
        if (!parsed.success)
          return sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
        const updated = await storage.pinChatConversation(
          id,
          req.userId,
          parsed.data.isPinned,
        );
        if (!updated)
          return sendError(
            res,
            404,
            "Conversation not found",
            ErrorCode.NOT_FOUND,
          );
        res.json(updated);
      } catch (error) {
        handleRouteError(res, error, "pin conversation");
      }
    },
  );

  // DELETE /api/chat/messages/:id - Delete message
  app.delete(
    "/api/chat/messages/:id",
    requireAuth,
    chatRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const id = parsePositiveIntParam(req.params.id);
        if (!id)
          return sendError(
            res,
            400,
            "Invalid message ID",
            ErrorCode.VALIDATION_ERROR,
          );
        const deleted = await storage.deleteChatMessage(id, req.userId);
        if (!deleted)
          return sendError(res, 404, "Message not found", ErrorCode.NOT_FOUND);
        res.status(204).send();
      } catch (error) {
        handleRouteError(res, error, "delete chat message");
      }
    },
  );

  // POST /api/chat/messages/:id/report - Report an AI reply (privacy audit
  // 2026-11-10, G7: Google Play asks for an in-app report control on
  // AI-generated content). Saves the reply id, the reason and who reported,
  // never the text; `.strict()` keeps free text out. No premium or AI-sharing
  // gate: someone who turned AI off can still report an old reply. Its own
  // limiter, inline so CodeQL's js/missing-rate-limiting can see it, and so
  // reports never spend the chat send budget.
  const reportSchema = z
    .object({ reason: z.enum(CHAT_MESSAGE_REPORT_REASON_IDS) })
    .strict();

  app.post(
    "/api/chat/messages/:id/report",
    requireAuth,
    rateLimit({
      windowMs: 60_000,
      max: resolveRateLimitMax(10, process.env),
      message: {
        error: "Too many reports. Please wait.",
        code: ErrorCode.RATE_LIMITED,
      },
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req: Request) => req.userId || ipKeyGenerator(req),
    }),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const id = parsePositiveIntParam(req.params.id);
        if (!id)
          return sendError(
            res,
            400,
            "Invalid message ID",
            ErrorCode.VALIDATION_ERROR,
          );
        const parsed = reportSchema.safeParse(req.body);
        if (!parsed.success)
          return sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
        const saved = await storage.reportChatMessage(
          id,
          req.userId,
          parsed.data.reason,
        );
        if (!saved)
          return sendError(res, 404, "Message not found", ErrorCode.NOT_FOUND);
        res.status(204).send();
      } catch (error) {
        handleRouteError(res, error, "report chat message");
      }
    },
  );
}
