import type { Express, Request, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAuth } from "../middleware/auth";
import {
  chatRateLimit,
  formatZodError,
  parsePositiveIntParam,
  parseQueryInt,
  checkPremiumFeature,
  checkAiConfigured,
} from "./_helpers";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import {
  generateCoachResponse,
  type CoachContext,
} from "../services/nutrition-coach";

export function register(app: Express): void {
  // GET /api/chat/conversations - List conversations
  app.get(
    "/api/chat/conversations",
    requireAuth,
    chatRateLimit,
    async (req: Request, res: Response) => {
      try {
        const limit = parseQueryInt(req.query.limit, { default: 50, max: 50 });
        const conversations = await storage.getChatConversations(
          req.userId!,
          limit,
        );
        res.json(conversations);
      } catch (error) {
        console.error("Chat error:", error);
        sendError(
          res,
          500,
          "Failed to list conversations",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // POST /api/chat/conversations - Create conversation
  app.post(
    "/api/chat/conversations",
    requireAuth,
    chatRateLimit,
    async (req: Request, res: Response) => {
      try {
        const schema = z.object({ title: z.string().max(200).optional() });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success)
          return sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );

        const conversation = await storage.createChatConversation(
          req.userId!,
          parsed.data.title || "New Chat",
        );
        res.status(201).json(conversation);
      } catch (error) {
        console.error("Chat error:", error);
        sendError(
          res,
          500,
          "Failed to create conversation",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // GET /api/chat/conversations/:id/messages - Get messages
  app.get(
    "/api/chat/conversations/:id/messages",
    requireAuth,
    chatRateLimit,
    async (req: Request, res: Response) => {
      try {
        const id = parsePositiveIntParam(req.params.id);
        if (!id)
          return sendError(
            res,
            400,
            "Invalid conversation ID",
            ErrorCode.VALIDATION_ERROR,
          );

        const conversation = await storage.getChatConversation(id, req.userId!);
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
        console.error("Chat error:", error);
        sendError(
          res,
          500,
          "Failed to fetch messages",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // POST /api/chat/conversations/:id/messages - Send message + stream response
  app.post(
    "/api/chat/conversations/:id/messages",
    requireAuth,
    chatRateLimit,
    async (req: Request, res: Response) => {
      try {
        const id = parsePositiveIntParam(req.params.id);
        if (!id)
          return sendError(
            res,
            400,
            "Invalid conversation ID",
            ErrorCode.VALIDATION_ERROR,
          );

        const conversation = await storage.getChatConversation(id, req.userId!);
        if (!conversation)
          return sendError(
            res,
            404,
            "Conversation not found",
            ErrorCode.NOT_FOUND,
          );

        const schema = z.object({ content: z.string().min(1).max(2000) });
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

        const features = await checkPremiumFeature(
          req,
          res,
          "aiCoach",
          "AI Coach",
        );
        if (!features) return;

        const user = await storage.getUser(req.userId!);
        if (!user)
          return sendError(res, 401, "Unauthorized", ErrorCode.UNAUTHORIZED);

        // Atomically check daily limit and create message in a single
        // transaction to prevent TOCTOU races bypassing the limit.
        const message = await storage.createChatMessageWithLimitCheck(
          id,
          req.userId!,
          parsed.data.content,
          features.dailyCoachMessages,
        );

        if (!message) {
          return sendError(
            res,
            429,
            "Daily chat message limit reached",
            "DAILY_LIMIT_REACHED",
          );
        }

        // Build context in parallel
        const today = new Date();
        const [profile, dailySummary, latestWeight, history] =
          await Promise.all([
            storage.getUserProfile(req.userId!),
            storage.getDailySummary(req.userId!, today),
            storage.getLatestWeight(req.userId!),
            storage.getChatMessages(id, 20),
          ]);

        const context: CoachContext = {
          // When user has no calorie goal, pass null so the coach knows goals aren't set.
          // Macro fallbacks are 0 (not DEFAULT_NUTRITION_GOALS) because the coach should
          // only reference macros the user has explicitly configured.
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
        };

        const messageHistory = history.map((m) => ({
          role: m.role as "user" | "assistant" | "system",
          content: m.content,
        }));

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

        let fullResponse = "";
        try {
          for await (const chunk of generateCoachResponse(
            messageHistory,
            context,
          )) {
            if (aborted) break;
            fullResponse += chunk;
            res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
          }

          // Save assistant message (full or partial) to maintain conversation consistency
          if (fullResponse) {
            await storage.createChatMessage(id, "assistant", fullResponse);
          }

          // Update conversation title if this is the first exchange
          if (!aborted && history.length <= 1) {
            const shortTitle =
              parsed.data.content.slice(0, 50) +
              (parsed.data.content.length > 50 ? "..." : "");
            await storage.updateChatConversationTitle(
              id,
              req.userId!,
              shortTitle,
            );
          }

          if (!aborted) {
            res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
          }
        } catch (error) {
          console.error("Chat streaming error:", error);
          if (!aborted) {
            res.write(
              `data: ${JSON.stringify({ error: "Failed to generate response" })}\n\n`,
            );
          }
          // Save partial response so conversation stays consistent
          if (fullResponse) {
            await storage
              .createChatMessage(id, "assistant", fullResponse)
              .catch(() => {});
          }
        }
        res.end();
      } catch (error) {
        console.error("Chat error:", error);
        if (!res.headersSent) {
          sendError(
            res,
            500,
            "Failed to send message",
            ErrorCode.INTERNAL_ERROR,
          );
        }
      }
    },
  );

  // DELETE /api/chat/conversations/:id - Delete conversation
  app.delete(
    "/api/chat/conversations/:id",
    requireAuth,
    chatRateLimit,
    async (req: Request, res: Response) => {
      try {
        const id = parsePositiveIntParam(req.params.id);
        if (!id)
          return sendError(
            res,
            400,
            "Invalid conversation ID",
            ErrorCode.VALIDATION_ERROR,
          );

        const deleted = await storage.deleteChatConversation(id, req.userId!);
        if (!deleted)
          return sendError(
            res,
            404,
            "Conversation not found",
            ErrorCode.NOT_FOUND,
          );
        res.status(204).send();
      } catch (error) {
        console.error("Chat error:", error);
        sendError(
          res,
          500,
          "Failed to delete conversation",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );
}
