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
import { chatRateLimit } from "./_rate-limiters";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import {
  generateCoachResponse,
  type CoachContext,
} from "../services/nutrition-coach";
import {
  generateRecipeChatResponse,
  buildRecipeContext,
  type RecipeChatRecipe,
} from "../services/recipe-chat";
import { logger, toError } from "../lib/logger";
import { createHash } from "crypto";

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
        const limit = parseQueryInt(req.query.limit, { default: 50, max: 50 });
        const typeParam = req.query.type as string | undefined;
        const type =
          typeParam === "coach" || typeParam === "recipe"
            ? typeParam
            : undefined;
        const conversations = await storage.getChatConversations(
          req.userId,
          limit,
          type,
        );
        res.json(conversations);
      } catch (error) {
        handleRouteError(res, error, "list conversations");
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
          type: z.enum(["coach", "recipe"]).default("coach"),
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success)
          return sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );

        const conversation = await storage.createChatConversation(
          req.userId,
          parsed.data.title ||
            (parsed.data.type === "recipe" ? "New Recipe Chat" : "New Chat"),
          parsed.data.type,
        );
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

        const messages = await storage.getChatMessages(id, 100);
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

        const featureKey = isRecipeChat ? "recipeGeneration" : "aiCoach";
        const featureLabel = isRecipeChat ? "Recipe Generation" : "AI Coach";
        const features = await checkPremiumFeature(
          req,
          res,
          featureKey as "recipeGeneration" | "aiCoach",
          featureLabel,
        );
        if (!features) return;

        const user = await storage.getUser(req.userId);
        if (!user)
          return sendError(res, 401, "Unauthorized", ErrorCode.UNAUTHORIZED);

        // Atomically check daily limit and create message in a single
        // transaction to prevent TOCTOU races bypassing the limit.
        const dailyLimit = isRecipeChat
          ? features.dailyRecipeGenerations
          : features.dailyCoachMessages;
        const message = await storage.createChatMessageWithLimitCheck(
          id,
          req.userId,
          parsed.data.content,
          dailyLimit,
          conversation.type as "coach" | "recipe",
        );

        if (!message) {
          return sendError(
            res,
            429,
            isRecipeChat
              ? "Daily recipe generation limit reached"
              : "Daily chat message limit reached",
            ErrorCode.DAILY_LIMIT_REACHED,
          );
        }

        // Stream response via SSE
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.flushHeaders();

        // Track client disconnect to stop consuming OpenAI tokens
        let aborted = false;
        req.on("close", () => {
          aborted = true;
        });

        // SSE timeout — prevent hung connections
        const sseTimeout = setTimeout(() => {
          aborted = true;
          if (!res.writableEnded) {
            res.write(
              `data: ${JSON.stringify({ error: "Response timeout" })}\n\n`,
            );
            res.end();
          }
        }, SSE_TIMEOUT_MS);

        let responseBytes = 0;

        try {
          if (isRecipeChat) {
            // ─── RECIPE CHAT PATH ────────────────────────────────
            const [profile, history] = await Promise.all([
              storage.getUserProfile(req.userId),
              storage.getChatMessages(id, 10),
            ]);

            const contextMessages = buildRecipeContext(history);

            let fullTextResponse = "";
            let recipeData: RecipeChatRecipe | null = null;
            let allergenWarning: string | null = null;
            let recipeImageUrl: string | null = null;

            for await (const event of generateRecipeChatResponse(
              contextMessages,
              profile,
              parsed.data.screenContext,
            )) {
              if (aborted) break;

              const eventJson = JSON.stringify(event);
              responseBytes += eventJson.length;
              if (responseBytes > SSE_MAX_RESPONSE_BYTES) {
                aborted = true;
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
              } else if ("content" in event && event.content) {
                fullTextResponse += event.content;
                res.write(`data: ${eventJson}\n\n`);
              }
            }

            // Save assistant message with recipe in metadata
            if (fullTextResponse || recipeData) {
              const metadata = recipeData
                ? {
                    metadataVersion: 1,
                    recipe: recipeData,
                    allergenWarning,
                    imageUrl: recipeImageUrl,
                  }
                : null;

              await storage.createChatMessage(
                id,
                "assistant",
                fullTextResponse || "Here's a recipe for you!",
                metadata,
              );
            }

            // Auto-title from recipe name on first exchange
            if (!aborted && recipeData) {
              const history2 = await storage.getChatMessages(id, 3);
              if (history2.length <= 3) {
                await storage.updateChatConversationTitle(
                  id,
                  req.userId,
                  recipeData.title,
                );
              }
            }
          } else {
            // ─── COACH CHAT PATH (existing) ──────────────────────
            const today = new Date();
            const [profile, dailySummary, latestWeight, history] =
              await Promise.all([
                storage.getUserProfile(req.userId),
                storage.getDailySummary(req.userId, today),
                storage.getLatestWeight(req.userId),
                storage.getChatMessages(id, 20),
              ]);

            const context: CoachContext = {
              goals: user.dailyCalorieGoal
                ? {
                    calories: user.dailyCalorieGoal,
                    protein: user.dailyProteinGoal || 0,
                    carbs: user.dailyCarbsGoal || 0,
                    fat: user.dailyFatGoal || 0,
                  }
                : null,
              todayIntake: {
                calories: Number(dailySummary.totalCalories),
                protein: Number(dailySummary.totalProtein),
                carbs: Number(dailySummary.totalCarbs),
                fat: Number(dailySummary.totalFat),
              },
              weightTrend: {
                currentWeight: latestWeight
                  ? parseFloat(latestWeight.weight)
                  : null,
                weeklyRate: null,
              },
              dietaryProfile: {
                dietType: profile?.dietType || null,
                allergies: (
                  (profile?.allergies as { name: string }[] | null) || []
                ).map((a) => a.name),
                dislikes: (profile?.foodDislikes as string[]) || [],
              },
              screenContext: parsed.data.screenContext,
            };

            const messageHistory = history.map((m) => ({
              role: m.role as "user" | "assistant" | "system",
              content: m.content,
            }));

            // Check cache for predefined questions (no screenContext = universal answer)
            const isCacheable =
              !parsed.data.screenContext && history.length <= 1;
            const questionHash = isCacheable
              ? createHash("sha256")
                  .update(parsed.data.content.trim().toLowerCase())
                  .digest("hex")
                  .slice(0, 32)
              : null;

            let cachedResponse: string | null = null;
            if (questionHash) {
              cachedResponse =
                await storage.getCoachCachedResponse(questionHash);
            }

            let fullResponse = "";

            if (cachedResponse) {
              // Send cached response in 3 chunks with minimal delay
              const len = cachedResponse.length;
              const third = Math.ceil(len / 3);
              const chunks = [
                cachedResponse.slice(0, third),
                cachedResponse.slice(third, third * 2),
                cachedResponse.slice(third * 2),
              ].filter((c) => c.length > 0);
              for (let ci = 0; ci < chunks.length && !aborted; ci++) {
                fullResponse += chunks[ci];
                res.write(
                  `data: ${JSON.stringify({ content: chunks[ci] })}\n\n`,
                );
                if (ci < chunks.length - 1) {
                  await new Promise((r) => setTimeout(r, 15));
                }
              }
            } else {
              for await (const chunk of generateCoachResponse(
                messageHistory,
                context,
              )) {
                if (aborted) break;
                fullResponse += chunk;
                res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
              }

              if (questionHash && fullResponse && !aborted) {
                storage
                  .setCoachCachedResponse(
                    questionHash,
                    parsed.data.content,
                    fullResponse,
                  )
                  .catch(() => {});
              }
            }

            if (fullResponse) {
              await storage.createChatMessage(id, "assistant", fullResponse);
            }

            if (!aborted && history.length <= 1) {
              const shortTitle =
                parsed.data.content.slice(0, 50) +
                (parsed.data.content.length > 50 ? "..." : "");
              await storage.updateChatConversationTitle(
                id,
                req.userId,
                shortTitle,
              );
            }
          }

          if (!aborted) {
            res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
          }
        } catch (error) {
          logger.error({ err: toError(error) }, "chat streaming error");
          if (!aborted && !res.writableEnded) {
            res.write(
              `data: ${JSON.stringify({ error: "Failed to generate response" })}\n\n`,
            );
          }
        } finally {
          clearTimeout(sseTimeout);
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
}
