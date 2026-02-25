import type { Express, Request, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAuth } from "../middleware/auth";
import { chatRateLimit, formatZodError, parsePositiveIntParam, parseQueryInt } from "./_helpers";
import { sendError } from "../lib/api-errors";
import {
  generateCoachResponse,
  type CoachContext,
} from "../services/nutrition-coach";
import { TIER_FEATURES, isValidSubscriptionTier } from "@shared/types/premium";

export function register(app: Express): void {
  // GET /api/chat/conversations - List conversations
  app.get(
    "/api/chat/conversations",
    requireAuth,
    chatRateLimit,
    async (req: Request, res: Response) => {
      const limit = parseQueryInt(req.query.limit, { default: 50, max: 50 });
      const conversations = await storage.getChatConversations(
        req.userId!,
        limit,
      );
      res.json(conversations);
    },
  );

  // POST /api/chat/conversations - Create conversation
  app.post(
    "/api/chat/conversations",
    requireAuth,
    chatRateLimit,
    async (req: Request, res: Response) => {
      const schema = z.object({ title: z.string().max(200).optional() });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success)
        return sendError(res, 400, formatZodError(parsed.error));

      const conversation = await storage.createChatConversation(
        req.userId!,
        parsed.data.title || "New Chat",
      );
      res.status(201).json(conversation);
    },
  );

  // GET /api/chat/conversations/:id/messages - Get messages
  app.get(
    "/api/chat/conversations/:id/messages",
    requireAuth,
    chatRateLimit,
    async (req: Request, res: Response) => {
      const id = parsePositiveIntParam(req.params.id);
      if (!id)
        return sendError(res, 400, "Invalid conversation ID");

      const conversation = await storage.getChatConversation(id, req.userId!);
      if (!conversation)
        return sendError(res, 404, "Conversation not found");

      const messages = await storage.getChatMessages(id, 100);
      res.json(messages);
    },
  );

  // POST /api/chat/conversations/:id/messages - Send message + stream response
  app.post(
    "/api/chat/conversations/:id/messages",
    requireAuth,
    chatRateLimit,
    async (req: Request, res: Response) => {
      const id = parsePositiveIntParam(req.params.id);
      if (!id)
        return sendError(res, 400, "Invalid conversation ID");

      const conversation = await storage.getChatConversation(id, req.userId!);
      if (!conversation)
        return sendError(res, 404, "Conversation not found");

      const schema = z.object({ content: z.string().min(1).max(2000) });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success)
        return sendError(res, 400, formatZodError(parsed.error));

      // Check daily message limit
      const user = await storage.getUser(req.userId!);
      if (!user) return sendError(res, 401, "Unauthorized");

      const subscription = await storage.getSubscriptionStatus(req.userId!);
      const tier = subscription?.tier || "free";
      const features =
        TIER_FEATURES[isValidSubscriptionTier(tier) ? tier : "free"];

      const dailyCount = await storage.getDailyChatMessageCount(
        req.userId!,
        new Date(),
      );
      if (dailyCount >= features.dailyCoachMessages) {
        return sendError(
          res,
          429,
          "Daily chat message limit reached",
          "DAILY_LIMIT_REACHED",
        );
      }

      // Save user message
      await storage.createChatMessage(id, "user", parsed.data.content);

      // Build context
      const [profile, dailySummary, exerciseSummary, latestWeight] =
        await Promise.all([
          storage.getUserProfile(req.userId!),
          storage.getDailySummary(req.userId!, new Date()),
          storage.getExerciseDailySummary(req.userId!, new Date()),
          storage.getLatestWeight(req.userId!),
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
          currentWeight: latestWeight ? parseFloat(latestWeight.weight) : null,
          weeklyRate: null,
        },
        dietaryProfile: {
          dietType: profile?.dietType || null,
          allergies: (
            (profile?.allergies as { name: string }[] | null) || []
          ).map((a) => a.name),
          dislikes: (profile?.foodDislikes as string[]) || [],
        },
        recentExercise: {
          todayCaloriesBurned: exerciseSummary.totalCaloriesBurned,
          todayMinutes: exerciseSummary.totalMinutes,
        },
      };

      // Get conversation history for context
      const history = await storage.getChatMessages(id, 20);
      const messageHistory = history.map((m) => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
      }));

      // Stream response via SSE
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();

      let fullResponse = "";
      try {
        for await (const chunk of generateCoachResponse(
          messageHistory,
          context,
        )) {
          fullResponse += chunk;
          res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
        }

        // Save assistant message
        await storage.createChatMessage(id, "assistant", fullResponse);

        // Update conversation title if this is the first exchange
        if (history.length <= 1) {
          const shortTitle =
            parsed.data.content.slice(0, 50) +
            (parsed.data.content.length > 50 ? "..." : "");
          await storage.updateChatConversationTitle(
            id,
            req.userId!,
            shortTitle,
          );
        }

        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      } catch {
        res.write(
          `data: ${JSON.stringify({ error: "Failed to generate response" })}\n\n`,
        );
      }
      res.end();
    },
  );

  // DELETE /api/chat/conversations/:id - Delete conversation
  app.delete(
    "/api/chat/conversations/:id",
    requireAuth,
    chatRateLimit,
    async (req: Request, res: Response) => {
      const id = parsePositiveIntParam(req.params.id);
      if (!id)
        return sendError(res, 400, "Invalid conversation ID");

      const deleted = await storage.deleteChatConversation(id, req.userId!);
      if (!deleted) return sendError(res, 404, "Conversation not found");
      res.json({ success: true });
    },
  );
}
