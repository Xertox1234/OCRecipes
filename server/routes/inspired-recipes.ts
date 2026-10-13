// Inspired recipes (spec 2026-10-12 §4): create a listing, poll cards, and
// "Make this mine" (turn a card into the user's own private recipe).
import { z } from "zod";
import type { Express, Response } from "express";
import { storage } from "../storage";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { createSuggestionListing } from "../services/inspired-recipes";
import {
  generateFullRecipe,
  generateAndPatchRecipeImage,
  normalizeProductName,
} from "../services/recipe-generation";
import { normalizeRecipeFields } from "../lib/recipe-normalization";
import { inferMealTypes } from "../services/meal-type-inference";
import { fireAndForget } from "../lib/fire-and-forget";
import { mealPlanRateLimit, recipeGenerationRateLimit } from "./_rate-limiters";
import {
  checkPremiumFeature,
  formatZodError,
  handleRouteError,
  parsePositiveIntParam,
  parseTimezone,
} from "./_helpers";
import {
  createListingBodySchema,
  INSPIRED_DAILY_CARD_CAP,
  INSPIRED_LISTING_SIZE,
  MAKING_STALE_MS,
  SUGGESTION_TTL_MS,
  toSuggestion,
} from "@shared/schemas/inspired-recipes";

const idsQuerySchema = z.object({
  ids: z
    .string()
    .regex(/^\d+(,\d+){0,19}$/)
    .transform((s) => s.split(",").map(Number)),
});

export function register(app: Express): void {
  // POST /api/inspired/suggestions — create a listing (premium)
  app.post(
    "/api/inspired/suggestions",
    requireAuth,
    recipeGenerationRateLimit, // 1 search + 1 AI call + 8 images per request
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "catalogSave",
          "Recipe ideas",
        );
        if (!features) return;

        const parsed = createListingBodySchema.safeParse(req.body);
        if (!parsed.success) {
          sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }
        const todayCount = await storage.countInspiredSuggestionsSince(
          req.userId,
          new Date(Date.now() - SUGGESTION_TTL_MS),
        );
        if (todayCount >= INSPIRED_DAILY_CARD_CAP) {
          sendError(
            res,
            429,
            "You've reached today's limit for recipe ideas.",
            ErrorCode.DAILY_LIMIT_REACHED,
          );
          return;
        }
        const { query, ...filters } = parsed.data;
        const profile = await storage.getUserProfile(req.userId);
        const suggestions = await createSuggestionListing({
          userId: req.userId,
          request: query,
          filters,
          profile,
          count: INSPIRED_LISTING_SIZE,
          useSpoonacular: true,
        });
        if (!suggestions) {
          sendError(
            res,
            502,
            "Couldn't come up with ideas — try again",
            ErrorCode.AI_UNAVAILABLE,
          );
          return;
        }
        res.status(201).json({ suggestions });
      } catch (error) {
        handleRouteError(res, error, "create inspired listing");
      }
    },
  );

  // GET /api/inspired/suggestions?ids=1,2,3 — poll cards (owner rows only)
  app.get(
    "/api/inspired/suggestions",
    requireAuth,
    mealPlanRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const parsed = idsQuerySchema.safeParse(req.query);
        if (!parsed.success) {
          sendError(
            res,
            400,
            "ids must be 1-20 comma-separated integers",
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }
        const rows = await storage.getInspiredSuggestions(
          req.userId,
          parsed.data.ids,
        );
        res.json({ suggestions: rows.map(toSuggestion) });
      } catch (error) {
        handleRouteError(res, error, "poll inspired suggestions");
      }
    },
  );

  // POST /api/inspired/suggestions/:id/make — turn a card into a private recipe
  app.post(
    "/api/inspired/suggestions/:id/make",
    requireAuth,
    recipeGenerationRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const id = parsePositiveIntParam(req.params.id);
        if (!id) {
          sendError(
            res,
            400,
            "Invalid suggestion id",
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }
        const features = await checkPremiumFeature(
          req,
          res,
          "recipeGeneration",
          "Recipe generation",
        );
        if (!features) return;

        const suggestion = await storage.getInspiredSuggestion(req.userId, id);
        if (!suggestion) {
          sendError(res, 404, "Suggestion not found", ErrorCode.NOT_FOUND);
          return;
        }
        if (suggestion.madeRecipeId) {
          res.status(200).json({ recipeId: suggestion.madeRecipeId });
          return;
        }
        if (suggestion.expiresAt.getTime() < Date.now()) {
          sendError(
            res,
            410,
            "These ideas expired — refresh",
            ErrorCode.SUGGESTION_EXPIRED,
          );
          return;
        }

        // Early limit check (non-transactional fast path to avoid the AI call)
        const tz = parseTimezone(req.headers["x-timezone"]);
        const generationsToday = await storage.getDailyRecipeGenerationCount(
          req.userId,
          new Date(),
          tz,
        );
        if (generationsToday >= features.dailyRecipeGenerations) {
          sendError(
            res,
            429,
            "Daily recipe generation limit reached",
            ErrorCode.DAILY_LIMIT_REACHED,
          );
          return;
        }

        // One generation per card: a second tap while this runs gets 409.
        const lockToken = await storage.startMakingSuggestion(
          req.userId,
          id,
          MAKING_STALE_MS,
        );
        if (!lockToken) {
          sendError(
            res,
            409,
            "Already making this recipe",
            ErrorCode.MAKING_IN_PROGRESS,
          );
          return;
        }

        // From here every exit that does not finish the claim releases the
        // lock, so a failure never leaves the card stuck until MAKING_STALE_MS.
        let settled = false;
        let recipe;
        try {
          const profile = await storage.getUserProfile(req.userId);
          // The card (our own text) is the brief — never Spoonacular data.
          const generated = await generateFullRecipe({
            productName: `${suggestion.title}: ${suggestion.description}`,
            userProfile: profile,
          });
          const normalizedForMealTypes = normalizeRecipeFields({
            title: generated.title,
            ingredients: generated.ingredients,
          });
          const mealTypes = inferMealTypes(
            normalizedForMealTypes.title ?? generated.title,
            (
              normalizedForMealTypes.ingredients ??
              generated.ingredients ??
              []
            ).map((i) => i.name),
          );
          // createRecipeWithLimitCheck also writes recipeGenerationLog in the
          // same transaction, which is what marks the recipe AI-generated.
          recipe = await storage.createRecipeWithLimitCheck(
            req.userId,
            features.dailyRecipeGenerations,
            {
              authorId: req.userId,
              barcode: null,
              normalizedProductName: normalizeProductName(suggestion.title),
              title: generated.title,
              description: generated.description,
              difficulty: generated.difficulty,
              timeEstimate: generated.timeEstimate,
              servings: 2,
              dietTags: generated.dietTags,
              mealTypes,
              instructions: generated.instructions,
              ingredients: generated.ingredients,
              imageUrl: suggestion.imageUrl,
              isPublic: false,
            },
            tz,
          );
          if (!recipe) {
            sendError(
              res,
              429,
              "Daily recipe generation limit reached",
              ErrorCode.DAILY_LIMIT_REACHED,
            );
            return;
          }
          const claimed = await storage.claimInspiredSuggestionMade(
            req.userId,
            id,
            recipe.id,
          );
          settled = true;
          if (!claimed) {
            // A concurrent tap won the claim: hand back the winner's recipe.
            const winner = await storage.getInspiredSuggestion(req.userId, id);
            res
              .status(200)
              .json({ recipeId: winner?.madeRecipeId ?? recipe.id });
            return;
          }
        } finally {
          if (!settled) {
            // Best effort: a failed release self-heals after MAKING_STALE_MS.
            await storage
              .abandonMakingSuggestion(id, lockToken)
              .catch(() => undefined);
          }
        }

        res.status(201).json({ recipeId: recipe.id });
        if (!suggestion.imageUrl) {
          fireAndForget(
            "inspired recipe image",
            generateAndPatchRecipeImage(recipe.id, {
              title: recipe.title,
              mealTypes: recipe.mealTypes,
            }),
          );
        }
      } catch (error) {
        handleRouteError(res, error, "make inspired recipe");
      }
    },
  );
}
