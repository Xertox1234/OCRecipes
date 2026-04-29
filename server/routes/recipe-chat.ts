import type { Express, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { chatRateLimit } from "./_rate-limiters";
import { createImageUpload } from "./_upload";
import {
  formatZodError,
  parsePositiveIntParam,
  checkPremiumFeature,
  checkAiConfigured,
  handleRouteError,
} from "./_helpers";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { detectImageMimeType } from "../lib/image-mime";
import {
  analyzeImageForRecipe,
  RECIPE_SUGGESTION_CHIPS,
} from "../services/recipe-chat";
import {
  remixConversationMetadataSchema,
  recipeChatMetadataSchema,
} from "@shared/schemas/recipe-chat";
import { inferMealTypes } from "../services/meal-type-inference";

// 5MB limit for recipe ingredient photos
const recipeImageUpload = createImageUpload(5 * 1024 * 1024);

export function register(app: Express): void {
  // GET /api/chat/suggestions - Get suggestion chips (agent-native endpoint)
  app.get(
    "/api/chat/suggestions",
    requireAuth,
    chatRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      const type = req.query.type as string | undefined;
      if (type === "recipe") {
        return res.json(RECIPE_SUGGESTION_CHIPS);
      }
      // Default: return empty (coach uses hardcoded prompts on client)
      res.json([]);
    },
  );

  // POST /api/chat/conversations/:id/save-recipe - Save recipe from chat
  app.post(
    "/api/chat/conversations/:id/save-recipe",
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

        const schema = z.object({
          messageId: z.number().int().positive(),
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success)
          return sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );

        // Check if this is a remix conversation — pass lineage if so
        const [conversation, chatMessage] = await Promise.all([
          storage.getChatConversation(id, req.userId),
          storage.getChatMessageById(parsed.data.messageId, id),
        ]);
        let lineage:
          | { remixedFromId: number; remixedFromTitle: string }
          | undefined;
        if (conversation?.type === "remix") {
          const parsedMeta = remixConversationMetadataSchema.safeParse(
            conversation.metadata,
          );
          if (parsedMeta.success) {
            lineage = {
              remixedFromId: parsedMeta.data.sourceRecipeId,
              remixedFromTitle: parsedMeta.data.sourceRecipeTitle,
            };
          }
        }

        // Compute mealTypes at the route layer (storage-layer purity — M5).
        // Pre-read the message metadata to infer types before the storage transaction.
        let mealTypes: string[] | undefined;
        if (chatMessage?.metadata) {
          const parsedMeta = recipeChatMetadataSchema.safeParse(
            chatMessage.metadata,
          );
          if (parsedMeta.success) {
            mealTypes = inferMealTypes(
              parsedMeta.data.recipe.title,
              parsedMeta.data.recipe.ingredients.map((i) => i.name),
            );
          }
        }

        const recipe = await storage.saveRecipeFromChat(
          parsed.data.messageId,
          id,
          req.userId,
          lineage,
          mealTypes,
        );

        if (!recipe)
          return sendError(
            res,
            404,
            "Recipe not found in message",
            ErrorCode.NOT_FOUND,
          );

        res.status(201).json(recipe);
      } catch (error) {
        handleRouteError(res, error, "save recipe from chat");
      }
    },
  );

  // POST /api/chat/conversations/:id/upload-image - Upload image for recipe chat
  app.post(
    "/api/chat/conversations/:id/upload-image",
    requireAuth,
    chatRateLimit,
    recipeImageUpload.single("photo"),
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

        if (!req.file)
          return sendError(
            res,
            400,
            "No image provided",
            ErrorCode.VALIDATION_ERROR,
          );

        // Magic-byte validation (defense-in-depth beyond MIME type check)
        const detectedMime = detectImageMimeType(req.file.buffer);
        if (!detectedMime)
          return sendError(
            res,
            400,
            "Invalid image content",
            ErrorCode.VALIDATION_ERROR,
          );

        // Minimum file size check
        if (req.file.buffer.length < 100)
          return sendError(
            res,
            400,
            "Image too small",
            ErrorCode.VALIDATION_ERROR,
          );

        // Verify conversation ownership
        const conversation = await storage.getChatConversation(id, req.userId);
        if (!conversation)
          return sendError(
            res,
            404,
            "Conversation not found",
            ErrorCode.NOT_FOUND,
          );

        // Premium gate
        if (!checkAiConfigured(res)) return;
        const features = await checkPremiumFeature(
          req,
          res,
          "recipeGeneration",
          "Recipe Generation",
        );
        if (!features) return;

        // Analyze image with Vision API
        const imageBase64 = req.file.buffer.toString("base64");
        const mimeType = detectedMime as
          | "image/jpeg"
          | "image/png"
          | "image/webp";
        const ingredientAnalysis = await analyzeImageForRecipe(
          imageBase64,
          mimeType,
        );

        // Save user message with image analysis in metadata
        const message = await storage.createChatMessage(
          id,
          "user",
          ingredientAnalysis,
          {
            imageAnalysis: true,
            detectedIngredients: ingredientAnalysis,
          },
        );

        res.status(201).json({
          message,
          ingredientAnalysis,
        });
      } catch (error) {
        if (!res.headersSent) {
          handleRouteError(res, error, "upload recipe image");
        }
      }
    },
  );
}
