import type { Express, Response } from "express";
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
} from "./_helpers";
import { chatRateLimit, chatReadRateLimit } from "./_rate-limiters";
import { fireAndForget } from "../lib/fire-and-forget";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { logger, toError } from "../lib/logger";
import { tryArchiveNotebook } from "../services/coach-pro-chat";
import { sanitizeUserInput } from "../lib/ai-safety";
import { finderActionSchema } from "@shared/schemas/recipe-finder";
import { admitTurn } from "./chat-admit";
import {
  CONVERSATION_CONFIG,
  runTurn,
  type ConversationType,
} from "./chat-stream";

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
        const typeParam = req.query.type as string | undefined;
        const type =
          typeParam === "coach" ||
          typeParam === "recipe" ||
          typeParam === "remix"
            ? typeParam
            : undefined;
        const search =
          typeof req.query.search === "string"
            ? req.query.search.trim()
            : undefined;
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
          sourceRecipeId: z.number().int().positive().optional(),
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

        const messages = await storage.getChatMessages(id, 100, req.userId);
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
          screenContext: z.string().max(1500).optional(),
          warmUpId: z.string().max(100).optional(),
          turnKey: z.string().uuid().optional(),
          // Recipe finder button taps (R2): structured, never parsed from
          // `content`, and never from route params (#1147/#1148).
          finderAction: finderActionSchema.optional(),
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
}
