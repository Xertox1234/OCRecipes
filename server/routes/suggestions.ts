import type { Express, Request, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAuth } from "../middleware/auth";
import { type Allergy } from "@shared/schema";
import { calculateProfileHash } from "../utils/profile-hash";
import { instructionsRateLimit } from "./_helpers";
import { openai } from "../lib/openai";

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
    async (req: Request, res: Response) => {
      try {
        const itemId = parseInt(req.params.id as string, 10);
        if (isNaN(itemId) || itemId <= 0) {
          return res.status(400).json({ error: "Invalid item ID" });
        }

        const item = await storage.getScannedItem(itemId);

        // IDOR protection: verify user owns the item
        if (!item || item.userId !== req.userId) {
          return res.status(404).json({ error: "Item not found" });
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
          storage.incrementSuggestionCacheHit(cached.id).catch(console.error);
          return res.json({
            suggestions: cached.suggestions,
            cacheId: cached.id,
          });
        }

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

        const prompt = `Given this food item: "${item.productName}"${item.brandName ? ` by ${item.brandName}` : ""}, generate creative suggestions.

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
              content:
                "You are a helpful culinary and crafts assistant. Always respond with valid JSON only, no markdown formatting.",
            },
            { role: "user", content: prompt },
          ],
          response_format: { type: "json_object" },
          max_completion_tokens: 1024,
        });

        const responseText = completion.choices[0]?.message?.content || "{}";
        const suggestions = JSON.parse(responseText);

        // Cache the result (30 days TTL)
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        const cacheEntry = await storage.createSuggestionCache(
          itemId,
          req.userId!,
          profileHash,
          suggestions.suggestions,
          expiresAt,
        );

        res.json({
          suggestions: suggestions.suggestions,
          cacheId: cacheEntry.id,
        });
      } catch (error) {
        console.error("Error generating suggestions:", error);
        res.status(500).json({ error: "Failed to generate suggestions" });
      }
    },
  );

  app.post(
    "/api/items/:itemId/suggestions/:suggestionIndex/instructions",
    requireAuth,
    instructionsRateLimit,
    async (req: Request, res: Response) => {
      try {
        const itemId = parseInt(req.params.itemId as string, 10);
        const suggestionIndex = parseInt(
          req.params.suggestionIndex as string,
          10,
        );

        if (isNaN(itemId) || itemId <= 0) {
          return res.status(400).json({ error: "Invalid item ID" });
        }
        if (isNaN(suggestionIndex) || suggestionIndex < 0) {
          return res.status(400).json({ error: "Invalid suggestion index" });
        }

        const item = await storage.getScannedItem(itemId);
        if (!item) {
          return res.status(404).json({ error: "Item not found" });
        }

        // Validate user owns the item
        if (item.userId !== req.userId) {
          return res.status(403).json({ error: "Not authorized" });
        }

        const parsed = instructionsRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          return res
            .status(400)
            .json({ error: "Invalid input", details: parsed.error.flatten() });
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
            storage
              .incrementInstructionCacheHit(cachedInstruction.id)
              .catch(console.error);
            return res.json({ instructions: cachedInstruction.instructions });
          }
        }

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

        let prompt: string;
        if (suggestionType === "recipe") {
          prompt = `Write detailed cooking instructions for: "${suggestionTitle}"

This recipe uses "${item.productName}"${item.brandName ? ` by ${item.brandName}` : ""} as a main ingredient.

${dietaryContext ? `User preferences: ${dietaryContext}` : ""}

Provide clear, numbered step-by-step instructions. Include:
1. A brief ingredients list (with approximate amounts)
2. Preparation steps
3. Cooking steps
4. Any helpful tips

Keep instructions practical and easy to follow. Format as plain text with clear sections.`;
        } else if (suggestionType === "craft") {
          prompt = `Write detailed instructions for the kid-friendly activity: "${suggestionTitle}"

This activity is inspired by "${item.productName}".

Provide clear, numbered step-by-step instructions. Include:
1. Materials needed
2. Setup instructions
3. Activity steps
4. Safety notes (if applicable)
5. Fun variations or extensions

Keep instructions simple and safe for children. Format as plain text with clear sections.`;
        } else {
          // pairing
          prompt = `Explain in detail why these foods pair well: "${suggestionTitle}"

Based on "${item.productName}"${item.brandName ? ` by ${item.brandName}` : ""}.

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
              content:
                "You are a helpful culinary and crafts assistant. Provide clear, practical instructions.",
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
          storage
            .createInstructionCache(
              cacheId,
              suggestionIndex,
              suggestionTitle,
              suggestionType,
              instructions,
            )
            .catch(console.error);
        }

        res.json({ instructions });
      } catch (error) {
        console.error("Error generating instructions:", error);
        res.status(500).json({ error: "Failed to generate instructions" });
      }
    },
  );
}
