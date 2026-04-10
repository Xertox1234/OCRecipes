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
import { fireAndForget } from "../lib/fire-and-forget";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import {
  generateCoachResponse,
  generateCoachProResponse,
  type CoachContext,
} from "../services/nutrition-coach";
import {
  generateRecipeChatResponse,
  buildRecipeContext,
  buildRemixSystemPrompt,
  type RecipeChatRecipe,
} from "../services/recipe-chat";
import { remixConversationMetadataSchema } from "@shared/schemas/recipe-chat";
import { logger, toError } from "../lib/logger";
import { createHash } from "crypto";
import {
  parseBlocksFromContent,
  BLOCKS_SYSTEM_PROMPT,
} from "../services/coach-blocks";
import { extractNotebookEntries } from "../services/notebook-extraction";
import { sanitizeContextField } from "../lib/ai-safety";
import { consumeWarmUp } from "./coach-context";
import type { CoachBlock } from "@shared/schemas/coach-blocks";

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
          typeParam === "coach" ||
          typeParam === "recipe" ||
          typeParam === "remix"
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

          // Fetch source recipe to validate it exists and is accessible
          remixSourceRecipe = await storage.getCommunityRecipe(
            parsed.data.sourceRecipeId,
          );
          if (!remixSourceRecipe) {
            return sendError(
              res,
              404,
              "Source recipe not found",
              ErrorCode.NOT_FOUND,
            );
          }

          // Block remixing private recipes the user doesn't own
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
          warmUpId: z.string().max(100).optional(),
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

        const featureKey =
          isRecipeChat || isRemixChat ? "recipeGeneration" : "aiCoach";
        const featureLabel = isRemixChat
          ? "Recipe Remix"
          : isRecipeChat
            ? "Recipe Generation"
            : "AI Coach";
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
        const dailyLimit =
          isRecipeChat || isRemixChat
            ? features.dailyRecipeGenerations
            : features.coachPro
              ? features.coachProDailyMessages
              : features.dailyCoachMessages;
        const message = await storage.createChatMessageWithLimitCheck(
          id,
          req.userId,
          parsed.data.content,
          dailyLimit,
          conversation.type as "coach" | "recipe" | "remix",
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
          if (isRecipeChat || isRemixChat) {
            // ─── RECIPE / REMIX CHAT PATH ────────────────────────
            const remixSourceId = isRemixChat
              ? remixConversationMetadataSchema.safeParse(conversation.metadata)
                  ?.data?.sourceRecipeId
              : undefined;

            const [profile, history, sourceRecipe] = await Promise.all([
              storage.getUserProfile(req.userId),
              storage.getChatMessages(id, 10),
              remixSourceId
                ? storage.getCommunityRecipe(remixSourceId)
                : undefined,
            ]);

            const contextMessages = buildRecipeContext(history);

            // For remix, build a specialized system prompt with the original recipe
            let remixPromptOverride: string | undefined;
            if (isRemixChat && sourceRecipe) {
              remixPromptOverride = buildRemixSystemPrompt(
                {
                  title: sourceRecipe.title,
                  ingredients: sourceRecipe.ingredients as {
                    name: string;
                    quantity: string;
                    unit: string;
                  }[],
                  instructions: sourceRecipe.instructions as string[],
                  dietTags: sourceRecipe.dietTags as string[],
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

            for await (const event of generateRecipeChatResponse(
              contextMessages,
              profile,
              parsed.data.screenContext,
              remixPromptOverride
                ? { systemPromptOverride: remixPromptOverride }
                : undefined,
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

            // Auto-title from recipe name on first exchange (fire-and-forget — non-critical)
            // history.length is the count before this exchange; +2 for user+assistant messages
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

            // ── Coach Pro: inject notebook context ──────────────
            const isCoachPro = !!features.coachPro;
            if (isCoachPro) {
              const notebookEntries = await storage.getActiveNotebookEntries(
                req.userId,
              );
              if (notebookEntries.length > 0) {
                // Budget ~800 tokens (~3200 chars) for notebook context
                const MAX_NOTEBOOK_CHARS = 3200;
                let charCount = 0;
                const lines: string[] = [];
                for (const e of notebookEntries) {
                  const line = `[${e.type}] ${sanitizeContextField(e.content, 500)}`;
                  if (charCount + line.length > MAX_NOTEBOOK_CHARS) break;
                  lines.push(line);
                  charCount += line.length;
                }
                context.notebookSummary =
                  lines.join("\n") + "\n\n" + BLOCKS_SYSTEM_PROMPT;
              } else {
                context.notebookSummary = BLOCKS_SYSTEM_PROMPT;
              }
            }

            let messageHistory = history.map((m) => ({
              role: m.role as "user" | "assistant" | "system",
              content: m.content,
            }));

            // ── Coach Pro: consume warm-up if available ─────────
            const warmUpId = parsed.data.warmUpId;
            if (isCoachPro && warmUpId) {
              const warmedUp = consumeWarmUp(req.userId, warmUpId);
              if (warmedUp) {
                // Warm-up already has conversation history — use it
                // The last message in warmedUp is the interim transcript;
                // replace it with the final transcript
                warmedUp[warmedUp.length - 1] = {
                  role: "user",
                  content: parsed.data.content,
                };
                messageHistory = warmedUp as typeof messageHistory;
              }
            }

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
            } else if (isCoachPro) {
              for await (const chunk of generateCoachProResponse(
                messageHistory,
                context,
                req.userId,
              )) {
                if (aborted) break;
                fullResponse += chunk;
                res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
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
                fireAndForget(
                  "coach-cache-response",
                  storage.setCoachCachedResponse(
                    questionHash,
                    parsed.data.content,
                    fullResponse,
                  ),
                );
              }
            }

            // Parse blocks from response for Coach Pro
            let blocks: CoachBlock[] = [];
            let textContent = fullResponse;
            if (isCoachPro && fullResponse) {
              const parsed_blocks = parseBlocksFromContent(fullResponse);
              textContent = parsed_blocks.text;
              blocks = parsed_blocks.blocks;
            }

            if (fullResponse) {
              await storage.createChatMessage(
                id,
                "assistant",
                textContent,
                blocks.length > 0 ? { blocks } : null,
              );
            }

            if (!aborted && history.length <= 1) {
              const shortTitle =
                parsed.data.content.slice(0, 50) +
                (parsed.data.content.length > 50 ? "..." : "");
              fireAndForget(
                "coach-chat-auto-title",
                storage.updateChatConversationTitle(id, req.userId, shortTitle),
              );
            }

            // Send blocks in the final event for Coach Pro
            if (!aborted && blocks.length > 0) {
              res.write(`data: ${JSON.stringify({ blocks })}\n\n`);
            }

            // Fire-and-forget notebook extraction for Coach Pro
            if (isCoachPro && fullResponse && !aborted) {
              fireAndForget(
                "coach-notebook-extraction",
                (async () => {
                  const allMessages = [
                    ...messageHistory,
                    { role: "user" as const, content: parsed.data.content },
                    { role: "assistant" as const, content: textContent },
                  ];
                  const entries = await extractNotebookEntries(
                    allMessages,
                    req.userId,
                    id,
                  );
                  if (entries.length > 0) {
                    await storage.createNotebookEntries(
                      entries.map((e) => ({
                        userId: req.userId,
                        type: e.type,
                        content: e.content,
                        status: "active",
                        followUpDate: e.followUpDate
                          ? new Date(e.followUpDate)
                          : null,
                        sourceConversationId: id,
                      })),
                    );
                  }
                })(),
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
