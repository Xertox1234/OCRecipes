import type { Express, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import {
  checkPremiumFeature,
  handleRouteError,
  parseTimezone,
} from "./_helpers";
import { crudRateLimit, chatRateLimit } from "./_rate-limiters";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import {
  setWarmUp,
  generateWarmUpId,
  type WarmUpMessageRole,
} from "../services/coach-warm-up";
import { sanitizeUserInput } from "../lib/ai-safety";
import { logger } from "../lib/logger";
import { buildCoachContext } from "../services/coach-context-builder";

/** Runtime guard — validates a DB `text` role before using it as a union member. */
function isWarmUpRole(r: string): r is WarmUpMessageRole {
  return r === "user" || r === "assistant" || r === "system";
}

export function register(app: Express): void {
  // GET /api/coach/context
  app.get(
    "/api/coach/context",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "coachPro",
          "Coach Pro",
        );
        if (!features) return;

        const data = await buildCoachContext(
          req.userId,
          features,
          parseTimezone(req.headers["x-timezone"]),
        );
        res.json(data);
      } catch (error) {
        handleRouteError(res, error, "get coach context");
      }
    },
  );

  // POST /api/coach/warm-up
  // Use chatRateLimit (20 req/min) rather than crudRateLimit (30 req/min) because
  // warm-up pre-fetches conversation history and builds OpenAI context — as
  // expensive as a full chat turn (L19).
  app.post(
    "/api/coach/warm-up",
    requireAuth,
    chatRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "coachPro",
          "Coach Pro",
        );
        if (!features) return;

        const schema = z.object({
          conversationId: z.number(),
          interimTranscript: z.string().min(1).max(2000),
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
          return sendError(
            res,
            400,
            "Invalid warm-up request",
            ErrorCode.VALIDATION_ERROR,
          );
        }

        const { conversationId, interimTranscript } = parsed.data;

        const conversation = await storage.getChatConversation(
          conversationId,
          req.userId,
        );
        if (!conversation) {
          return sendError(
            res,
            404,
            "Conversation not found",
            ErrorCode.NOT_FOUND,
          );
        }

        // M3: Only coach-type conversations support warm-up. Warming a
        // recipe/remix conversation wastes the user's slot — reject it.
        if (conversation.type !== "coach") {
          return sendError(
            res,
            400,
            "Warm-up is only supported for coach conversations",
            ErrorCode.VALIDATION_ERROR,
          );
        }

        // Pre-fetch conversation history
        const messages = await storage.getChatMessages(
          conversationId,
          20,
          req.userId,
        );
        const prepared = messages.flatMap((m) => {
          if (!isWarmUpRole(m.role)) {
            logger.warn(
              { messageId: m.id, role: m.role },
              "warm-up: dropping message with unexpected role",
            );
            return [];
          }
          return [{ role: m.role, content: m.content }];
        });
        prepared.push({
          role: "user",
          content: sanitizeUserInput(interimTranscript),
        });

        // Cryptographically-random warm-up id (defense-in-depth — previously
        // `${userId}-${Date.now()}` was trivially guessable).
        const warmUpId = generateWarmUpId();

        const stored = setWarmUp(
          req.userId,
          conversationId,
          warmUpId,
          prepared,
        );
        if (!stored.ok) {
          return sendError(res, 429, stored.reason, stored.code);
        }

        res.json({ warmUpId });
      } catch (error) {
        handleRouteError(res, error, "coach warm-up");
      }
    },
  );
}
