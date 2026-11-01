import type { Express, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { civilDateToInstant } from "../lib/civil-date";
import { generateRecipeImage } from "../services/recipe-generation";
import { fireAndForget } from "../lib/fire-and-forget";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { AI_DAILY_CAPS } from "@shared/types/premium";
import { isValidCalendarDate } from "../utils/date-validation";
import {
  mealPlanRateLimit,
  mealConfirmRateLimit,
  pantryMealPlanRateLimit,
  crudRateLimit,
} from "./_rate-limiters";
import {
  checkAiConfigured,
  checkPremiumFeature,
  formatZodError,
  getPremiumFeatures,
  handleRouteError,
  parsePositiveIntParam,
  parseQueryString,
  parseTimezone,
} from "./_helpers";

import { logger, toError } from "../lib/logger";
import { isUniqueViolation } from "../lib/db-errors";
import {
  buildPantryMealPlanForUser,
  EmptyPantryError,
} from "../services/pantry-meal-plan";
import { inferMealTypes } from "../services/meal-type-inference";
import { validateRecipeQuality } from "../lib/recipe-validation";
import { normalizeRecipeFields } from "../lib/recipe-normalization";

import {
  addMealPlanItemSchema,
  createMealPlanRecipeSchema,
  validateMealPlanDateRange,
} from "./_meal-plan-schemas";

export { validateMealPlanDateRange };

/** Meal types inferred from the normalized title + ingredient names. */
function inferRecipeMealTypes(
  title: string,
  ingredients:
    | { name: string; quantity?: string | null; unit?: string | null }[]
    | undefined,
) {
  // normalizeRecipeFields feeds inferMealTypes clean title/ingredient input;
  // persistence normalization happens in storage.
  const normalized = normalizeRecipeFields({ title, ingredients });
  return inferMealTypes(
    normalized.title ?? title,
    normalized.ingredients?.map((i) => i.name),
  );
}

/**
 * Auto-generate a hero image for a recipe saved without one (non-blocking).
 * Premium only: free users keep the placeholder and no image call is made.
 * Premium users are bounded by a DB-backed daily cap claimed BEFORE the paid
 * call; a refused claim just skips the image (the save already succeeded).
 */
function fireRecipeImageGen(
  recipe: {
    id: number;
    title: string;
    cuisine: string | null;
    mealTypes: string[] | null;
  },
  req: AuthenticatedRequest,
): void {
  const userId = req.userId;
  fireAndForget(
    "recipe-image-gen",
    (async () => {
      const features = await getPremiumFeatures(req);
      if (!features.recipeAutoImages) return;
      const claimed = await storage.claimDailyAiCall(
        userId,
        "recipeAutoImage",
        AI_DAILY_CAPS.recipeAutoImage,
      );
      if (!claimed) return;
      const imageUrl = await generateRecipeImage({
        title: recipe.title,
        cuisine: recipe.cuisine,
        mealTypes: recipe.mealTypes,
      });
      if (imageUrl) {
        await storage.updateMealPlanRecipe(recipe.id, userId, { imageUrl });
      }
    })(),
  );
}

export function register(app: Express): void {
  // GET /api/meal-plan/recipes - Get user's meal plan recipes
  app.get(
    "/api/meal-plan/recipes",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const recipes = await storage.getUserMealPlanRecipes(req.userId);
        res.json(recipes);
      } catch (error) {
        handleRouteError(res, error, "fetch recipes");
      }
    },
  );

  // GET /api/meal-plan/recipes/:id - Get a specific recipe with ingredients
  app.get(
    "/api/meal-plan/recipes/:id",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const id = parsePositiveIntParam(req.params.id);
        if (!id) {
          sendError(res, 400, "Invalid recipe ID", ErrorCode.VALIDATION_ERROR);
          return;
        }

        const recipe = await storage.getMealPlanRecipeWithIngredients(
          id,
          req.userId,
        );
        if (!recipe) {
          sendError(res, 404, "Recipe not found", ErrorCode.NOT_FOUND);
          return;
        }

        res.json(recipe);
      } catch (error) {
        handleRouteError(res, error, "fetch recipe");
      }
    },
  );

  // POST /api/meal-plan/recipes - Create a meal plan recipe
  app.post(
    "/api/meal-plan/recipes",
    requireAuth,
    mealPlanRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const parsed = createMealPlanRecipeSchema.safeParse(req.body);
        if (!parsed.success) {
          sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        const {
          ingredients,
          sourceType,
          sourceCommunityRecipeId,
          ...recipeData
        } = parsed.data;

        // Quality gate
        const quality = validateRecipeQuality({
          title: recipeData.title,
          instructions: recipeData.instructions,
          ingredients: ingredients ?? null,
        });
        if (!quality.valid) {
          sendError(res, 400, quality.reason!, ErrorCode.VALIDATION_ERROR);
          return;
        }

        const mealTypes = inferRecipeMealTypes(recipeData.title, ingredients);
        const recipe = await storage.createMealPlanRecipe(
          {
            ...recipeData,
            userId: req.userId,
            sourceType,
            mealTypes,
          },
          ingredients?.map((ing) => ({
            ...ing,
            recipeId: 0,
          })),
        );

        // Increment popularity counter for community recipe source (fire-and-forget)
        if (sourceCommunityRecipeId) {
          fireAndForget(
            "meal plan recipe popularity increment",
            storage.incrementRecipePopularity(
              sourceCommunityRecipeId,
              "mealPlan",
            ),
          );
        }

        // Auto-generate image if none provided (async, non-blocking)
        if (!recipe.imageUrl) fireRecipeImageGen(recipe, req);

        res.status(201).json(recipe);
      } catch (error) {
        handleRouteError(res, error, "create recipe");
      }
    },
  );

  // PUT /api/meal-plan/recipes/:id - Update a recipe
  app.put(
    "/api/meal-plan/recipes/:id",
    requireAuth,
    mealPlanRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const id = parsePositiveIntParam(req.params.id);
        if (!id) {
          sendError(res, 400, "Invalid recipe ID", ErrorCode.VALIDATION_ERROR);
          return;
        }

        const updateSchema = createMealPlanRecipeSchema
          .omit({ ingredients: true })
          .partial();
        const parsed = updateSchema.safeParse(req.body);
        if (!parsed.success) {
          sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        const recipe = await storage.updateMealPlanRecipe(
          id,
          req.userId,
          parsed.data,
        );
        if (!recipe) {
          sendError(res, 404, "Recipe not found", ErrorCode.NOT_FOUND);
          return;
        }

        res.json(recipe);
      } catch (error) {
        handleRouteError(res, error, "update recipe");
      }
    },
  );

  // DELETE /api/meal-plan/recipes/:id - Delete a recipe
  app.delete(
    "/api/meal-plan/recipes/:id",
    requireAuth,
    mealPlanRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const id = parsePositiveIntParam(req.params.id);
        if (!id) {
          sendError(res, 400, "Invalid recipe ID", ErrorCode.VALIDATION_ERROR);
          return;
        }

        const deleted = await storage.deleteMealPlanRecipe(id, req.userId);
        if (!deleted) {
          sendError(res, 404, "Recipe not found", ErrorCode.NOT_FOUND);
          return;
        }

        res.status(204).send();
      } catch (error) {
        handleRouteError(res, error, "delete recipe");
      }
    },
  );

  // GET /api/meal-plan - Get meal plan items for a date range
  app.get(
    "/api/meal-plan",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const start = parseQueryString(req.query.start);
        const end = parseQueryString(req.query.end);

        const validation = validateMealPlanDateRange(start, end);
        if (!validation.valid) {
          sendError(res, 400, validation.error, validation.code);
          return;
        }

        const items = await storage.getMealPlanItems(
          req.userId,
          validation.start,
          validation.end,
        );
        res.json(items);
      } catch (error) {
        handleRouteError(res, error, "fetch meal plan");
      }
    },
  );

  // POST /api/meal-plan/items - Add item to meal plan
  app.post(
    "/api/meal-plan/items",
    requireAuth,
    mealPlanRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const parsed = addMealPlanItemSchema.safeParse(req.body);
        if (!parsed.success) {
          sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        const { recipe: inlineRecipe, ...itemData } = parsed.data;
        const sources = [
          itemData.recipeId,
          itemData.scannedItemId,
          inlineRecipe,
        ].filter(Boolean).length;
        if (sources !== 1) {
          sendError(
            res,
            400,
            "Provide exactly one of recipeId, scannedItemId or recipe",
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        if (inlineRecipe) {
          const { ingredients, sourceType, ...recipeData } = inlineRecipe;
          const quality = validateRecipeQuality({
            title: recipeData.title,
            instructions: recipeData.instructions,
            ingredients: ingredients ?? null,
          });
          if (!quality.valid) {
            sendError(res, 400, quality.reason!, ErrorCode.VALIDATION_ERROR);
            return;
          }
          const normalized = normalizeRecipeFields({
            title: recipeData.title,
            description: recipeData.description,
            difficulty: recipeData.difficulty,
            instructions: recipeData.instructions,
          });
          const mealTypes = inferRecipeMealTypes(recipeData.title, ingredients);
          // Recipe + plan item in ONE transaction (a failed item insert leaves
          // no orphan recipe). Both rows are owned by req.userId only.
          const [created] = await storage.createMealPlanFromSuggestions([
            {
              recipe: {
                ...recipeData,
                title: normalized.title ?? recipeData.title,
                description: normalized.description,
                difficulty: normalized.difficulty,
                instructions:
                  normalized.instructions ?? recipeData.instructions,
                userId: req.userId,
                sourceType,
                mealTypes,
              },
              ingredients: (ingredients ?? []).map((ing, idx) => ({
                name: ing.name,
                quantity: ing.quantity ?? null,
                unit: ing.unit ?? null,
                category: ing.category,
                displayOrder: idx,
              })),
              planItem: {
                userId: req.userId,
                plannedDate: itemData.plannedDate,
                mealType: itemData.mealType,
                servings: itemData.servings,
              },
            },
          ]);
          if (!recipeData.imageUrl) {
            fireRecipeImageGen(
              {
                id: created.recipeId,
                title: recipeData.title,
                cuisine: recipeData.cuisine ?? null,
                mealTypes,
              },
              req,
            );
          }
          res.status(201).json({
            id: created.mealPlanItemId,
            recipeId: created.recipeId,
            plannedDate: itemData.plannedDate,
            mealType: itemData.mealType,
          });
          return;
        }

        // IDOR: verify recipe or scanned item belongs to user
        if (parsed.data.recipeId) {
          const recipe = await storage.getMealPlanRecipe(
            parsed.data.recipeId,
            req.userId,
          );
          if (!recipe) {
            sendError(res, 404, "Recipe not found", ErrorCode.NOT_FOUND);
            return;
          }
        }
        if (parsed.data.scannedItemId) {
          const item = await storage.getScannedItem(
            parsed.data.scannedItemId,
            req.userId,
          );
          if (!item) {
            sendError(res, 404, "Scanned item not found", ErrorCode.NOT_FOUND);
            return;
          }
        }

        const mealPlanItem = await storage.addMealPlanItem({
          ...itemData,
          userId: req.userId,
        });

        res.status(201).json(mealPlanItem);
      } catch (error) {
        handleRouteError(res, error, "add item to plan");
      }
    },
  );

  // DELETE /api/meal-plan/items/:id - Remove item from meal plan
  app.delete(
    "/api/meal-plan/items/:id",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const id = parsePositiveIntParam(req.params.id);
        if (!id) {
          sendError(res, 400, "Invalid item ID", ErrorCode.VALIDATION_ERROR);
          return;
        }

        const removed = await storage.removeMealPlanItem(id, req.userId);
        if (!removed) {
          sendError(res, 404, "Item not found", ErrorCode.NOT_FOUND);
          return;
        }

        res.status(204).send();
      } catch (error) {
        handleRouteError(res, error, "remove item");
      }
    },
  );

  // PATCH /api/meal-plan/reorder - Reorder meal plan items
  app.patch(
    "/api/meal-plan/reorder",
    requireAuth,
    mealPlanRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const schema = z.object({
          items: z
            .array(
              z.object({
                id: z.number().int().positive(),
                sortOrder: z.number().int().min(0),
              }),
            )
            .max(100),
        });

        const { items } = schema.parse(req.body);

        await storage.reorderMealPlanItems(req.userId, items);

        res.status(200).json({ success: true });
      } catch (error) {
        handleRouteError(res, error, "reorder items");
      }
    },
  );

  // ============================================================================
  // MEAL CONFIRMATION
  // ============================================================================

  // POST /api/meal-plan/items/:id/confirm — Confirm a meal plan item as eaten
  app.post(
    "/api/meal-plan/items/:id/confirm",
    requireAuth,
    mealConfirmRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "mealConfirmation",
          "Meal confirmation",
        );
        if (!features) return;

        const id = parsePositiveIntParam(req.params.id);
        if (!id) {
          sendError(
            res,
            400,
            "Invalid meal plan item ID",
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        // Fetch meal plan item and verify ownership (IDOR)
        const mealPlanItem = await storage.getMealPlanItemById(id, req.userId);
        if (!mealPlanItem) {
          sendError(res, 404, "Meal plan item not found", ErrorCode.NOT_FOUND);
          return;
        }

        // Check for duplicate confirmation.
        //
        // `plannedDate` is a `yyyy-mm-dd` date column, so it must be converted
        // to an instant inside that civil day IN THE USER'S ZONE. The previous
        // `new Date(plannedDate)` produced UTC midnight, so this searched the
        // UTC day, which overlaps the user's actual day only partially.
        //
        // This pre-check is an optimisation, not the guarantee: correctness
        // comes from `daily_logs_unique_meal_plan_confirm`, and the catch below
        // maps a unique violation to the same 409. Note that index is on
        // `(user_id, meal_plan_item_id)` with NO date component, so a duplicate
        // that slips past here still returns the identical response — the cost
        // of the old behaviour was a wasted round-trip, not a wrong answer.
        // (A pre-check that actually matched the constraint would be an
        // existence query on those two columns; this one bounds
        // `daily_logs.logged_at` by `plannedDate`'s day, and those two columns
        // have no enforced relationship — confirming a Sept 2 meal on Sept 4
        // misses in every timezone. Left as-is: out of scope here.)
        const tz = parseTimezone(req.headers["x-timezone"]);
        const confirmedIds = await storage.getConfirmedMealPlanItemIds(
          req.userId,
          civilDateToInstant(mealPlanItem.plannedDate, tz),
          tz,
        );
        if (confirmedIds.includes(id)) {
          sendError(
            res,
            409,
            "Meal plan item already confirmed",
            ErrorCode.ALREADY_CONFIRMED,
          );
          return;
        }

        // Create daily log entry
        const dailyLog = await storage.createDailyLog({
          userId: req.userId,
          scannedItemId: mealPlanItem.scannedItemId || null,
          recipeId: mealPlanItem.recipeId || null,
          mealPlanItemId: mealPlanItem.id,
          source: "meal_plan_confirm",
          servings: mealPlanItem.servings || "1",
          mealType: mealPlanItem.mealType,
        });

        res.status(201).json(dailyLog);
      } catch (error) {
        // Catch unique constraint violation from concurrent confirms
        if (isUniqueViolation(error)) {
          sendError(
            res,
            409,
            "Meal plan item already confirmed",
            ErrorCode.ALREADY_CONFIRMED,
          );
          return;
        }
        logger.error({ err: toError(error) }, "meal confirmation failed");
        sendError(res, 500, "Failed to confirm meal", ErrorCode.INTERNAL_ERROR);
      }
    },
  );

  // ============================================================================
  // PANTRY → MEAL PLAN GENERATION
  // ============================================================================

  // POST /api/meal-plan/generate-from-pantry — Generate a meal plan from pantry items
  app.post(
    "/api/meal-plan/generate-from-pantry",
    requireAuth,
    pantryMealPlanRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        if (!checkAiConfigured(res)) return;

        const features = await checkPremiumFeature(
          req,
          res,
          "aiMealSuggestions",
          "AI meal plan generation",
        );
        if (!features) return;

        const schema = z.object({
          days: z.number().int().min(1).max(7),
          startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        });

        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
          sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        if (!isValidCalendarDate(parsed.data.startDate)) {
          sendError(
            res,
            400,
            "Invalid calendar date",
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        const plan = await buildPantryMealPlanForUser(
          req.userId,
          parsed.data.days,
        );

        res.json(plan);
      } catch (error) {
        // Explicit catch: maps EmptyPantryError → 400 before the generic 500
        // path. Not using handleRouteError here because aiResponseSchema
        // parse failures inside the service must stay 500 (server-side AI
        // failure), not be re-mapped to 400 by handleRouteError's ZodError arm.
        if (error instanceof EmptyPantryError) {
          sendError(res, 400, error.message, ErrorCode.VALIDATION_ERROR);
          return;
        }
        logger.error(
          { err: toError(error) },
          "generate meal plan from pantry failed",
        );
        sendError(
          res,
          500,
          "Failed to generate meal plan",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // POST /api/meal-plan/save-generated — Batch-save a generated meal plan
  app.post(
    "/api/meal-plan/save-generated",
    requireAuth,
    mealPlanRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const mealSchema = z.object({
          mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]),
          title: z.string().min(1).max(200),
          description: z.string().max(2000).optional(),
          servings: z.number().int().min(1).max(50),
          prepTimeMinutes: z.number().int().min(0).max(1440),
          cookTimeMinutes: z.number().int().min(0).max(1440),
          difficulty: z.string().max(50).optional(),
          ingredients: z.array(
            z.object({
              name: z.string().min(1).max(200),
              quantity: z.coerce.string().optional().nullable(),
              unit: z.string().max(50).optional().nullable(),
            }),
          ),
          instructions: z.array(z.string()).max(100).optional(),
          dietTags: z.array(z.string().max(50)).max(20).optional(),
          caloriesPerServing: z.number().min(0),
          proteinPerServing: z.number().min(0),
          carbsPerServing: z.number().min(0),
          fatPerServing: z.number().min(0),
          plannedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        });

        const schema = z.object({
          meals: z.array(mealSchema).min(1).max(50),
        });

        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
          sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        // Validate all dates
        for (const meal of parsed.data.meals) {
          if (!isValidCalendarDate(meal.plannedDate)) {
            sendError(
              res,
              400,
              `Invalid calendar date: ${meal.plannedDate}`,
              ErrorCode.VALIDATION_ERROR,
            );
            return;
          }
        }

        // Create all recipes and plan items atomically
        const meals = parsed.data.meals.map((meal) => {
          const mealTypes = inferMealTypes(
            meal.title,
            meal.ingredients.map((i) => i.name),
          );

          return {
            recipe: {
              userId: req.userId,
              title: meal.title,
              description: meal.description ?? null,
              difficulty: meal.difficulty ?? null,
              servings: meal.servings,
              prepTimeMinutes: meal.prepTimeMinutes,
              cookTimeMinutes: meal.cookTimeMinutes,
              instructions: meal.instructions ?? undefined,
              dietTags: meal.dietTags ?? [],
              caloriesPerServing: String(meal.caloriesPerServing),
              proteinPerServing: String(meal.proteinPerServing),
              carbsPerServing: String(meal.carbsPerServing),
              fatPerServing: String(meal.fatPerServing),
              sourceType: "ai_suggestion" as const,
              mealTypes,
            },
            ingredients: meal.ingredients.map((ing, idx) => ({
              name: ing.name,
              quantity: ing.quantity ?? null,
              unit: ing.unit ?? null,
              displayOrder: idx,
            })),
            planItem: {
              userId: req.userId,
              plannedDate: meal.plannedDate,
              mealType: meal.mealType,
              servings: String(meal.servings),
            },
          };
        });

        const createdItems = await storage.createMealPlanFromSuggestions(meals);

        res.status(201).json({
          saved: createdItems.length,
          items: createdItems,
        });
      } catch (error) {
        handleRouteError(res, error, "save meal plan");
      }
    },
  );
}
