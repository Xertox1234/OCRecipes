import type { Express, Request, Response } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { storage } from "../storage";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { forgetAiSharing } from "../lib/ai-sharing-gate";
import { ErrorCode } from "@shared/constants/error-codes";
import { ipKeyGenerator, resolveRateLimitMax } from "./_rate-limiters";
import { handleRouteError } from "./_helpers";

/**
 * AI-sharing permission (privacy audit H3): the app names the AI companies
 * and records the user's answer here. The rule itself is enforced where the
 * AI call is made (`server/lib/ai-sharing-gate.ts`).
 */

const answerSchema = z.object({ allowed: z.boolean() });

// Inlined (not the crudRateLimit const) so CodeQL's js/missing-rate-limiting
// query can trace them — see server/routes/photos.ts. Same as crudRateLimit:
// 30/min, user-keyed with the IP fallback.
const limiter = () =>
  rateLimit({
    windowMs: 60 * 1000,
    max: resolveRateLimitMax(30, process.env),
    message: {
      error: "Too many requests. Please wait.",
      code: ErrorCode.RATE_LIMITED,
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => req.userId || ipKeyGenerator(req),
  });

export function register(app: Express): void {
  app.get(
    "/api/user/ai-sharing",
    requireAuth,
    limiter(),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const status = await storage.getAiSharingStatus(req.userId);
        if (!status) {
          return sendError(res, 404, "User not found", ErrorCode.NOT_FOUND);
        }
        res.json(status);
      } catch (error) {
        handleRouteError(res, error, "fetch AI-sharing permission");
      }
    },
  );

  app.put(
    "/api/user/ai-sharing",
    requireAuth,
    limiter(),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const { allowed } = answerSchema.parse(req.body);
        const status = await storage.setAiSharing(req.userId, allowed);
        if (!status) {
          return sendError(res, 404, "User not found", ErrorCode.NOT_FOUND);
        }
        // A remembered "yes" must not outlive the user turning it off.
        forgetAiSharing(req.userId);
        res.json(status);
      } catch (error) {
        handleRouteError(res, error, "save AI-sharing permission");
      }
    },
  );
}
