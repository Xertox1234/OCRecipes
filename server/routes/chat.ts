import { randomUUID } from "node:crypto";
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
  parseTimezone,
} from "./_helpers";
import { chatRateLimit } from "./_rate-limiters";
import { fireAndForget } from "../lib/fire-and-forget";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import {
  generateRecipeChatResponse,
  buildRecipeContext,
  buildRemixSystemPrompt,
  type RecipeChatRecipe,
} from "../services/recipe-chat";
import { remixConversationMetadataSchema } from "@shared/schemas/recipe-chat";
import { logger, toError } from "../lib/logger";
import {
  handleCoachChat,
  tryArchiveNotebook,
  STANDARD_SAFETY_MESSAGE,
} from "../services/coach-pro-chat";
import {
  sanitizeUserInput,
  sanitizeContextField,
  containsUnsafeCoachAdvice,
} from "../lib/ai-safety";
import { parseBlocksFromContent } from "../services/coach-blocks";

const SSE_TIMEOUT_MS = 120_000; // 2 minutes max per SSE connection
const SSE_MAX_RESPONSE_BYTES = 50 * 1024; // 50KB max response size

export function register(app: Express): void {
  // GET /api/chat/conversations - List conversations
  app.get(
    "/api/chat/conversations",
    requireAuth,
    chatRateLimit,
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
        const isRecipeChat = conversation.type === "recipe";
        const isRemixChat = conversation.type === "remix";
        const conversationType: "coach" | "recipe" | "remix" = isRemixChat
          ? "remix"
          : isRecipeChat
            ? "recipe"
            : "coach";

        const featureKey: "recipeGeneration" | "aiCoach" =
          isRecipeChat || isRemixChat ? "recipeGeneration" : "aiCoach";
        const featureLabel = isRemixChat
          ? "Recipe Remix"
          : isRecipeChat
            ? "Recipe Generation"
            : "AI Coach";
        const features = await checkPremiumFeature(
          req,
          res,
          featureKey,
          featureLabel,
        );
        if (!features) return;

        const user = await storage.getUser(req.userId);
        if (!user)
          return sendError(res, 401, "Unauthorized", ErrorCode.UNAUTHORIZED);

        // Atomically check daily limit and create message in a single
        // transaction to prevent TOCTOU races bypassing the limit.
        const dailyLimit =
          isRecipeChat || isRemixChat
            ? features.dailyRecipeGenerations
            : features.coachPro
              ? features.coachProDailyMessages
              : features.dailyCoachMessages;
        const sanitizedContent = sanitizeUserInput(parsed.data.content);
        const message = await storage.createChatMessageWithLimitCheck(
          id,
          req.userId,
          sanitizedContent,
          dailyLimit,
          conversationType,
        );

        if (!message) {
          return sendError(
            res,
            429,
            isRecipeChat || isRemixChat
              ? "Daily recipe generation limit reached"
              : features.coachPro
                ? "Daily Coach Pro message limit reached"
                : "Daily chat message limit reached",
            ErrorCode.DAILY_LIMIT_REACHED,
          );
        }

        // Stream response via SSE
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.flushHeaders();

        // Track client disconnect to stop consuming OpenAI tokens.
        // AbortController wires the HTTP close event directly into the OpenAI
        // SDK so in-flight generation is cancelled immediately, not just after
        // the next chunk boundary. (M8 — 2026-04-18)
        //
        // Listen on `res`, not `req`: express.json() has already consumed the
        // body, so the request's own "close" fired before this line and a
        // `req.on("close")` listener never runs (measured on Node 24, our
        // runtime) — M8 was dead code.
        // `!res.writableFinished` separates a dropped client from our own
        // res.end().
        //
        // Coach path only: the recipe/remix path cannot salvage a partial
        // (half a recipe JSON), so it keeps finishing and saving the reply
        // after a disconnect rather than burning quota for nothing.
        const isCoachPath = !isRecipeChat && !isRemixChat;
        const abortController = new AbortController();
        let aborted = false;
        let clientDisconnected = false;
        res.on("close", () => {
          if (res.writableFinished || !isCoachPath) return;
          clientDisconnected = true;
          aborted = true;
          abortController.abort();
        });

        // SSE timeout — prevent hung connections
        const sseTimeout = setTimeout(() => {
          aborted = true;
          abortController.abort();
          // The coach generators' own "streaming error" log is downgraded to
          // debug on any abort (a disconnect and this timeout share the
          // signal — see nutrition-coach.ts), so a genuine hang
          // would otherwise vanish above debug. Log it here, where the
          // SSE-timeout cause is unambiguous.
          logger.warn({ conversationId: id }, "chat SSE stream timed out");
          if (!res.writableEnded) {
            res.write(
              `data: ${JSON.stringify({ error: "Response timeout" })}\n\n`,
            );
            res.end();
          }
        }, SSE_TIMEOUT_MS);

        let responseBytes = 0;
        // Coach path: the content actually delivered to the client, and a
        // per-turn key so the service's write and the disconnect settle below
        // can tell whether this turn's reply already exists.
        let streamedContent = "";
        const coachTurnKey = parsed.data.turnKey ?? randomUUID();

        try {
          if (isRecipeChat || isRemixChat) {
            // ─── RECIPE / REMIX CHAT PATH ────────────────────────
            const remixSourceId = isRemixChat
              ? remixConversationMetadataSchema.safeParse(conversation.metadata)
                  ?.data?.sourceRecipeId
              : undefined;

            const [profile, history, sourceRecipe] = await Promise.all([
              storage.getUserProfile(req.userId),
              storage.getChatMessages(id, 10, req.userId),
              remixSourceId
                ? storage.getCommunityRecipe(remixSourceId, req.userId)
                : undefined,
            ]);

            const contextMessages = buildRecipeContext(history);

            // For remix, build a specialized system prompt with the original recipe
            let remixPromptOverride: string | undefined;
            if (isRemixChat && sourceRecipe) {
              remixPromptOverride = buildRemixSystemPrompt(
                {
                  title: sourceRecipe.title,
                  ingredients: sourceRecipe.ingredients ?? [],
                  instructions: sourceRecipe.instructions,
                  dietTags: sourceRecipe.dietTags ?? [],
                  description: sourceRecipe.description,
                  difficulty: sourceRecipe.difficulty,
                  timeEstimate: sourceRecipe.timeEstimate,
                  servings: sourceRecipe.servings,
                },
                profile,
              );
            }

            let fullTextResponse = "";
            let recipeData: RecipeChatRecipe | null = null;
            let allergenWarning: string | null = null;
            let recipeImageUrl: string | null = null;

            const sanitizedScreenContext = parsed.data.screenContext
              ? sanitizeContextField(parsed.data.screenContext, 200)
              : undefined;

            for await (const event of generateRecipeChatResponse(
              contextMessages,
              profile,
              sanitizedScreenContext,
              remixPromptOverride
                ? { systemPromptOverride: remixPromptOverride }
                : undefined,
            )) {
              // On this path `aborted` starts false and stays false unless
              // the byte-limit guard below or the SSE timeout trips it — a
              // client disconnect never reaches here (isCoachPath is false,
              // so res.on("close") above returns early). This break is not
              // a disconnect check any more.
              if (aborted) break;

              const eventJson = JSON.stringify(event);
              responseBytes += eventJson.length;
              if (responseBytes > SSE_MAX_RESPONSE_BYTES) {
                aborted = true;
                abortController.abort();
                // Closes the generator via return(), not a catch, so nothing
                // else logs this runaway response; record it here.
                logger.warn(
                  { conversationId: id, responseBytes },
                  "chat SSE response exceeded the size limit",
                );
                if (!res.writableEnded) {
                  res.write(
                    `data: ${JSON.stringify({ error: "Response too large" })}\n\n`,
                  );
                }
                break;
              }

              if ("done" in event && event.done) {
                // Terminal event — handled after loop
              } else if ("recipe" in event && event.recipe) {
                recipeData = event.recipe;
                allergenWarning = event.allergenWarning;
                res.write(`data: ${eventJson}\n\n`);
              } else if ("imageUrl" in event && event.imageUrl) {
                recipeImageUrl = event.imageUrl;
                res.write(`data: ${eventJson}\n\n`);
              } else if (
                "imageUnavailable" in event &&
                event.imageUnavailable
              ) {
                res.write(`data: ${eventJson}\n\n`);
              } else if ("content" in event && event.content) {
                fullTextResponse += event.content;
                res.write(`data: ${eventJson}\n\n`);
              }
            }

            // Save assistant message with recipe in metadata.
            // `aborted` here can only be true from the SSE timeout or the
            // byte-limit guard above — a client disconnect never sets it on
            // this path, so this gate does not skip saving on disconnect
            // (recipe/remix finish-and-save policy, P2-2026-09-24).
            if (!aborted && (fullTextResponse || recipeData)) {
              const metadata = recipeData
                ? {
                    metadataVersion: 1,
                    recipe: recipeData,
                    allergenWarning,
                    imageUrl: recipeImageUrl,
                  }
                : null;

              // Strip the JSON code block — recipe is in metadata; only save conversational text
              const conversationalText = fullTextResponse
                .replace(/\n*```json[\s\S]*?```\s*/g, "")
                .trim();

              await storage.createChatMessage(
                id,
                req.userId,
                "assistant",
                conversationalText || "Here's a recipe for you!",
                metadata,
              );
            }

            // Auto-title from recipe name on first exchange (fire-and-forget — non-critical)
            // history.length is the count before this exchange; +2 for user+assistant messages
            // Same `aborted` semantics as the persistence gate above — a
            // client disconnect does not skip this either.
            if (!aborted && recipeData && history.length <= 1) {
              fireAndForget(
                "recipe-chat-auto-title",
                storage.updateChatConversationTitle(
                  id,
                  req.userId,
                  recipeData.title,
                ),
              );
            }
          } else {
            // ─── COACH CHAT PATH ─────────────────────────────────
            for await (const event of handleCoachChat({
              conversationId: id,
              userId: req.userId,
              content: sanitizedContent,
              screenContext: parsed.data.screenContext,
              warmUpId: parsed.data.warmUpId,
              turnKey: coachTurnKey,
              isCoachPro: !!features.coachPro,
              user: {
                dailyCalorieGoal: user.dailyCalorieGoal,
                dailyProteinGoal: user.dailyProteinGoal,
                dailyCarbsGoal: user.dailyCarbsGoal,
                dailyFatGoal: user.dailyFatGoal,
                weight: user.weight,
                goalWeight: user.goalWeight,
                measurementUnit: user.measurementUnit,
              },
              tz: parseTimezone(req.headers["x-timezone"]),
              isAborted: () => aborted,
              abortSignal: abortController.signal,
            })) {
              if (aborted) break;
              const eventJson = JSON.stringify(
                event.type === "content"
                  ? { content: event.content }
                  : event.type === "status"
                    ? { status: event.label }
                    : event.type === "safety_override"
                      ? { safety_override: event.message }
                      : { blocks: event.blocks },
              );
              responseBytes += eventJson.length;
              if (responseBytes > SSE_MAX_RESPONSE_BYTES) {
                aborted = true;
                abortController.abort();
                // Closes the generator via return(), not a catch, so nothing
                // else logs this runaway response; record it here.
                logger.warn(
                  { conversationId: id, responseBytes },
                  "chat SSE response exceeded the size limit",
                );
                if (!res.writableEnded) {
                  res.write(
                    `data: ${JSON.stringify({ error: "Response too large" })}\n\n`,
                  );
                }
                break;
              }
              if (event.type === "content") streamedContent += event.content;
              // The override replaces what the client shows, as it does the
              // service's own fullResponse. Defensive: today no I/O await sits
              // between this event and the service's own save, so a close
              // cannot land in between — but if one ever does, a delivered
              // override must not count as "nothing streamed" (refund).
              else if (event.type === "safety_override")
                streamedContent = event.message;
              res.write(`data: ${eventJson}\n\n`);
            }
          }

          if (!aborted) {
            res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
          }
        } catch (error) {
          // A client disconnect aborts the OpenAI stream, which throws —
          // the expected exit, so log it at debug rather than error.
          if (clientDisconnected) {
            logger.debug(
              { err: toError(error) },
              "chat stream ended by client disconnect",
            );
          } else {
            logger.error({ err: toError(error) }, "chat streaming error");
          }
          if (!aborted && !res.writableEnded) {
            res.write(
              `data: ${JSON.stringify({ error: "Failed to generate response" })}\n\n`,
            );
          }
        } finally {
          clearTimeout(sseTimeout);
        }

        // H6 — the client left mid-answer. The user message is already
        // quota-counted (quota = count of today's user rows), so either
        // refund it (nothing was streamed) or keep what they paid for as the
        // assistant reply (something was). Refunding a turn whose content
        // was already delivered would let a client read an answer and abort
        // just before `done` to get the message back for free.
        if (clientDisconnected) {
          try {
            // Skip if the service's own write landed before the close did.
            const alreadyPersisted = await storage.getChatMessageByTurnKey(
              id,
              coachTurnKey,
            );
            if (!alreadyPersisted) {
              const parsedPartial = features.coachPro
                ? parseBlocksFromContent(streamedContent)
                : { text: streamedContent.trim(), blocks: [] };
              // An unterminated fence is half-written block JSON — the client
              // hid it while streaming, so it was never "delivered".
              const strippedText = parsedPartial.text
                .replace(/```coach_blocks[\s\S]*$/, "")
                .trim();
              // Free-tier deltas stream BEFORE the service's end-of-response
              // safety check, so a partial cut mid-stream was never vetted.
              const partialText = containsUnsafeCoachAdvice(strippedText)
                ? STANDARD_SAFETY_MESSAGE
                : strippedText;
              const { blocks } = parsedPartial;
              if (!partialText && blocks.length === 0) {
                await storage.deleteChatMessage(message.id, req.userId);
              } else {
                // Never cached, titled, or notebook-extracted — a partial.
                await storage.createChatMessage(
                  id,
                  req.userId,
                  "assistant",
                  partialText,
                  blocks.length > 0 ? { blocks } : null,
                  coachTurnKey,
                );
              }
            }
          } catch (error) {
            logger.error(
              { err: toError(error) },
              "failed to settle aborted coach turn",
            );
          }
        }
        res.end();
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
