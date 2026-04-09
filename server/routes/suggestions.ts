import type { Express, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { type AuthenticatedRequest, requireAuth } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { fireAndForget } from "../lib/fire-and-forget";
import { ErrorCode } from "@shared/constants/error-codes";
import { calculateProfileHash } from "../utils/profile-hash";
import { instructionsRateLimit, suggestionsRateLimit } from "./_rate-limiters";
import {
  parsePositiveIntParam,
  checkAiConfigured,
  handleRouteError,
} from "./_helpers";
import {
  generateSuggestions,
  generateInstructions,
  SuggestionParseError,
} from "../services/suggestion-generation";

// Zod schema for instructions request
const instructionsRequestSchema = z.object({
  suggestionTitle: z.string().min(1).max(200),
  suggestionType: z.enum(["recipe", "craft", "pairing"]),
  cacheId: z.number().int().positive().optional(),
});

export function register(app: Express): void {
  app.post(
    "/api/items/:id/suggestions",
    requireAuth,
    suggestionsRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const itemId = parsePositiveIntParam(req.params.id);
        if (!itemId) {
          return sendError(
            res,
            400,
            "Invalid item ID",
            ErrorCode.VALIDATION_ERROR,
          );
        }

        const item = await storage.getScannedItem(itemId, req.userId);
        if (!item) {
          return sendError(res, 404, "Item not found", ErrorCode.NOT_FOUND);
        }

        const userProfile = await storage.getUserProfile(req.userId);
        const profileHash = calculateProfileHash(userProfile);

        // Check cache first
        const cached = await storage.getSuggestionCache(
          itemId,
          req.userId,
          profileHash,
        );
        if (cached) {
          // Increment hit count in background
          fireAndForget(
            "suggestion-cache-hit",
            storage.incrementSuggestionCacheHit(cached.id),
          );
          return res.json({
            suggestions: cached.suggestions,
            cacheId: cached.id,
          });
        }

        // Cache miss — need AI to generate suggestions
        if (!checkAiConfigured(res)) return;

        const suggestions = await generateSuggestions({
          productName: item.productName || "",
          brandName: item.brandName,
          userProfile,
        });

        // Cache the result (30 days TTL)
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        const cacheEntry = await storage.createSuggestionCache(
          itemId,
          req.userId,
          profileHash,
          suggestions,
          expiresAt,
        );

        res.json({
          suggestions,
          cacheId: cacheEntry.id,
        });
      } catch (error) {
        if (error instanceof SuggestionParseError) {
          return sendError(res, 502, error.message, ErrorCode.INTERNAL_ERROR);
        }
        handleRouteError(res, error, "generate suggestions");
      }
    },
  );

  app.post(
    "/api/items/:itemId/suggestions/:suggestionIndex/instructions",
    requireAuth,
    instructionsRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const itemId = parsePositiveIntParam(req.params.itemId);
        const rawIndex = req.params.suggestionIndex;
        const suggestionIndex = parseInt(
          Array.isArray(rawIndex) ? rawIndex[0] : rawIndex,
          10,
        );

        if (!itemId) {
          return sendError(
            res,
            400,
            "Invalid item ID",
            ErrorCode.VALIDATION_ERROR,
          );
        }
        if (isNaN(suggestionIndex) || suggestionIndex < 0) {
          return sendError(
            res,
            400,
            "Invalid suggestion index",
            ErrorCode.VALIDATION_ERROR,
          );
        }

        const item = await storage.getScannedItem(itemId, req.userId);
        if (!item) {
          return sendError(res, 404, "Item not found", ErrorCode.NOT_FOUND);
        }

        const parsed = instructionsRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          return sendError(
            res,
            400,
            "Invalid input",
            ErrorCode.VALIDATION_ERROR,
          );
        }

        const { suggestionTitle, suggestionType, cacheId } = parsed.data;

        // Check instruction cache if cacheId provided
        if (cacheId) {
          const cachedInstruction = await storage.getInstructionCache(
            cacheId,
            suggestionIndex,
          );
          if (cachedInstruction) {
            // Increment hit count in background
            fireAndForget(
              "instruction-cache-hit",
              storage.incrementInstructionCacheHit(cachedInstruction.id),
            );
            return res.json({ instructions: cachedInstruction.instructions });
          }
        }

        // Cache miss — need AI to generate instructions
        if (!checkAiConfigured(res)) return;

        const userProfile = await storage.getUserProfile(req.userId);

        const instructions = await generateInstructions({
          productName: item.productName || "",
          brandName: item.brandName,
          suggestionTitle,
          suggestionType,
          userProfile,
        });

        // Cache the instruction if we have a cacheId
        if (cacheId) {
          fireAndForget(
            "instruction-cache-write",
            storage.createInstructionCache(
              cacheId,
              suggestionIndex,
              suggestionTitle,
              suggestionType,
              instructions,
            ),
          );
        }

        res.json({ instructions });
      } catch (error) {
        handleRouteError(res, error, "generate instructions");
      }
    },
  );
}
