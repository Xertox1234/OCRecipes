import type { Express, Request, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAuth } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { fireAndForget } from "../lib/fire-and-forget";
import { ErrorCode } from "@shared/constants/error-codes";
import { type Allergy } from "@shared/schema";
import { calculateProfileHash } from "../utils/profile-hash";
import {
  instructionsRateLimit,
  suggestionsRateLimit,
  parsePositiveIntParam,
  checkAiConfigured,
} from "./_helpers";
import { openai } from "../lib/openai";
import { sanitizeUserInput, SYSTEM_PROMPT_BOUNDARY } from "../lib/ai-safety";

// Zod schema for instructions request
const instructionsRequestSchema = z.object({
  suggestionTitle: z.string().min(1).max(200),
  suggestionType: z.enum(["recipe", "craft", "pairing"]),
  cacheId: z.number().int().positive().optional(),
});

// Zod schema for AI suggestion response
const suggestionItemSchema = z.object({
  type: z.enum(["recipe", "craft", "pairing"]),
  title: z.string(),
  description: z.string().default(""),
  difficulty: z.string().optional(),
  timeEstimate: z.string().optional(),
});

const suggestionsResponseSchema = z.object({
  suggestions: z.array(suggestionItemSchema).min(1),
});

export function register(app: Express): void {
  app.post(
    "/api/items/:id/suggestions",
    requireAuth,
    suggestionsRateLimit,
    async (req: Request, res: Response) => {
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

        const item = await storage.getScannedItem(itemId, req.userId!);
        if (!item) {
          return sendError(res, 404, "Item not found", ErrorCode.NOT_FOUND);
        }

        const userProfile = await storage.getUserProfile(req.userId!);
        const profileHash = calculateProfileHash(userProfile);

        // Check cache first
        const cached = await storage.getSuggestionCache(
          itemId,
          req.userId!,
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

        let dietaryContext = "";
        if (userProfile) {
          if (
            userProfile.allergies &&
            Array.isArray(userProfile.allergies) &&
            userProfile.allergies.length > 0
          ) {
            dietaryContext += `User allergies (avoid these ingredients): ${(userProfile.allergies as Allergy[]).map((a) => a.name).join(", ")}. `;
          }
          if (userProfile.dietType) {
            dietaryContext += `Diet: ${userProfile.dietType}. `;
          }
          if (userProfile.cookingSkillLevel) {
            dietaryContext += `Cooking skill: ${userProfile.cookingSkillLevel}. `;
          }
          if (userProfile.cookingTimeAvailable) {
            dietaryContext += `Time: ${userProfile.cookingTimeAvailable}. `;
          }
        }

        const safeName = sanitizeUserInput(item.productName || "");
        const safeBrand = item.brandName
          ? sanitizeUserInput(item.brandName)
          : "";

        const prompt = `Given this food item: "${safeName}"${safeBrand ? ` by ${safeBrand}` : ""}, generate creative suggestions.

${dietaryContext ? `User preferences: ${dietaryContext}` : ""}

Generate exactly 4 suggestions in this JSON format:
{
  "suggestions": [
    {
      "type": "recipe",
      "title": "Recipe name",
      "description": "Brief 1-2 sentence description of how to use this ingredient",
      "difficulty": "Easy/Medium/Hard",
      "timeEstimate": "15 min"
    },
    {
      "type": "recipe",
      "title": "Another recipe",
      "description": "Description",
      "difficulty": "Easy",
      "timeEstimate": "30 min"
    },
    {
      "type": "craft",
      "title": "Fun kid activity with food packaging or theme",
      "description": "Brief description of a creative activity for kids",
      "timeEstimate": "20 min"
    },
    {
      "type": "pairing",
      "title": "What goes well with this",
      "description": "Complementary foods or drinks that pair nicely"
    }
  ]
}

Keep descriptions concise. Make recipes practical and kid activities fun and safe. Return only valid JSON.`;

        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `You are a helpful culinary and crafts assistant. Always respond with valid JSON only, no markdown formatting. ${SYSTEM_PROMPT_BOUNDARY}`,
            },
            { role: "user", content: prompt },
          ],
          response_format: { type: "json_object" },
          max_completion_tokens: 1024,
        });

        const responseText = completion.choices[0]?.message?.content || "{}";
        const parsed = suggestionsResponseSchema.safeParse(
          JSON.parse(responseText),
        );
        if (!parsed.success) {
          return sendError(
            res,
            502,
            "AI returned an unexpected response format",
            ErrorCode.INTERNAL_ERROR,
          );
        }

        // Cache the result (30 days TTL)
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        const cacheEntry = await storage.createSuggestionCache(
          itemId,
          req.userId!,
          profileHash,
          parsed.data.suggestions,
          expiresAt,
        );

        res.json({
          suggestions: parsed.data.suggestions,
          cacheId: cacheEntry.id,
        });
      } catch (error) {
        console.error("Error generating suggestions:", error);
        sendError(
          res,
          500,
          "Failed to generate suggestions",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  app.post(
    "/api/items/:itemId/suggestions/:suggestionIndex/instructions",
    requireAuth,
    instructionsRateLimit,
    async (req: Request, res: Response) => {
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

        const item = await storage.getScannedItem(itemId, req.userId!);
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

        const userProfile = await storage.getUserProfile(req.userId!);

        let dietaryContext = "";
        if (userProfile) {
          if (
            userProfile.allergies &&
            Array.isArray(userProfile.allergies) &&
            userProfile.allergies.length > 0
          ) {
            dietaryContext += `User allergies (MUST avoid): ${(userProfile.allergies as Allergy[]).map((a) => a.name).join(", ")}. `;
          }
          if (userProfile.dietType) {
            dietaryContext += `Diet: ${userProfile.dietType}. `;
          }
          if (userProfile.cookingSkillLevel) {
            dietaryContext += `Skill level: ${userProfile.cookingSkillLevel}. `;
          }
        }

        const safeItemName = sanitizeUserInput(item.productName || "");
        const safeItemBrand = item.brandName
          ? sanitizeUserInput(item.brandName)
          : "";
        const safeTitle = sanitizeUserInput(suggestionTitle);

        let prompt: string;
        if (suggestionType === "recipe") {
          prompt = `Write detailed cooking instructions for: "${safeTitle}"

This recipe uses "${safeItemName}"${safeItemBrand ? ` by ${safeItemBrand}` : ""} as a main ingredient.

${dietaryContext ? `User preferences: ${dietaryContext}` : ""}

Provide clear, numbered step-by-step instructions. Include:
1. A brief ingredients list (with approximate amounts)
2. Preparation steps
3. Cooking steps
4. Any helpful tips

Keep instructions practical and easy to follow. Format as plain text with clear sections.`;
        } else if (suggestionType === "craft") {
          prompt = `Write detailed instructions for the kid-friendly activity: "${safeTitle}"

This activity is inspired by "${safeItemName}".

Provide clear, numbered step-by-step instructions. Include:
1. Materials needed
2. Setup instructions
3. Activity steps
4. Safety notes (if applicable)
5. Fun variations or extensions

Keep instructions simple and safe for children. Format as plain text with clear sections.`;
        } else {
          // pairing
          prompt = `Explain in detail why these foods pair well: "${safeTitle}"

Based on "${safeItemName}"${safeItemBrand ? ` by ${safeItemBrand}` : ""}.

${dietaryContext ? `User preferences: ${dietaryContext}` : ""}

Include:
1. Why these flavors complement each other
2. Serving suggestions
3. Preparation tips
4. Alternative pairings to try

Format as plain text with clear sections.`;
        }

        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `You are a helpful culinary and crafts assistant. Provide clear, practical instructions. ${SYSTEM_PROMPT_BOUNDARY}`,
            },
            { role: "user", content: prompt },
          ],
          max_completion_tokens: 1500,
        });

        const instructions =
          completion.choices[0]?.message?.content ||
          "Unable to generate instructions.";

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
        console.error("Error generating instructions:", error);
        sendError(
          res,
          500,
          "Failed to generate instructions",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );
}
