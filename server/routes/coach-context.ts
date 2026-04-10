import type { Express, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { checkPremiumFeature, handleRouteError } from "./_helpers";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { logger } from "../lib/logger";

// In-memory warm-up cache: userId → { warmUpId, messages, preparedAt }
const warmUpCache = new Map<
  string,
  {
    warmUpId: string;
    messages: Array<{ role: string; content: string }>;
    preparedAt: number;
  }
>();

const WARM_UP_TTL_MS = 30_000;

export function register(app: Express): void {
  // GET /api/coach/context
  app.get(
    "/api/coach/context",
    requireAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const features = await checkPremiumFeature(req, res, "coachPro", "Coach Pro");
        if (!features) return;

        const [profile, todayIntake, notebookEntries, dueCommitments] =
          await Promise.all([
            storage.getUserProfile(req.userId),
            storage.getDailySummary(req.userId, new Date()),
            storage.getActiveNotebookEntries(req.userId),
            storage.getCommitmentsWithDueFollowUp(req.userId),
          ]);

        // Generate contextual suggestion chips
        const suggestions: string[] = [];
        if (dueCommitments.length > 0) {
          suggestions.push(`How did "${dueCommitments[0].content}" go?`);
        }
        if (todayIntake) {
          const proteinGoal = 150; // Default, could come from profile goals
          const proteinLeft = proteinGoal - (todayIntake.totalProtein ?? 0);
          if (proteinLeft > 30) {
            suggestions.push(`I need ${Math.round(proteinLeft)}g more protein today`);
          }
        }
        const hour = new Date().getHours();
        if (hour < 11) {
          suggestions.push("Quick breakfast ideas");
        } else if (hour >= 17) {
          suggestions.push("How was my day?");
        }
        if (suggestions.length < 3) {
          suggestions.push("What should I eat next?");
        }

        res.json({
          goals: null, // TODO: integrate with calculateGoals when profile has physical data
          todayIntake,
          dietaryProfile: profile
            ? {
                dietType: profile.dietType,
                allergies: profile.allergies,
                dislikes: profile.foodDislikes,
              }
            : null,
          notebook: notebookEntries,
          dueCommitments,
          suggestions: suggestions.slice(0, 5),
        });
      } catch (error) {
        handleRouteError(res, error, "get coach context");
      }
    },
  );

  // POST /api/coach/warm-up
  app.post(
    "/api/coach/warm-up",
    requireAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const features = await checkPremiumFeature(req, res, "coachPro", "Coach Pro");
        if (!features) return;

        const schema = z.object({
          conversationId: z.number(),
          interimTranscript: z.string().min(1).max(2000),
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
          return sendError(res, 400, "Invalid warm-up request", ErrorCode.VALIDATION_ERROR);
        }

        const { conversationId, interimTranscript } = parsed.data;

        const conversation = await storage.getChatConversation(conversationId, req.userId);
        if (!conversation) {
          return sendError(res, 404, "Conversation not found", ErrorCode.NOT_FOUND);
        }

        // Pre-fetch conversation history
        const messages = await storage.getChatMessages(conversationId, 20);
        const prepared = messages.map((m) => ({ role: m.role, content: m.content }));
        prepared.push({ role: "user", content: interimTranscript });

        const warmUpId = `${req.userId}-${Date.now()}`;

        // Evict existing warm-up for this user
        warmUpCache.delete(req.userId);
        warmUpCache.set(req.userId, {
          warmUpId,
          messages: prepared,
          preparedAt: Date.now(),
        });

        res.json({ warmUpId });
      } catch (error) {
        handleRouteError(res, error, "coach warm-up");
      }
    },
  );
}

// Export for use by chat route
export function consumeWarmUp(
  userId: string,
  warmUpId: string,
): Array<{ role: string; content: string }> | null {
  const cached = warmUpCache.get(userId);
  if (!cached || cached.warmUpId !== warmUpId) return null;
  if (Date.now() - cached.preparedAt > WARM_UP_TTL_MS) {
    warmUpCache.delete(userId);
    return null;
  }
  warmUpCache.delete(userId);
  return cached.messages;
}
