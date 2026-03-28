import type { Express, Request, Response } from "express";
import { z, ZodError } from "zod";
import { storage } from "../storage";
import { requireAuth } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { isValidCalendarDate } from "../utils/date-validation";
import {
  mealPlanRateLimit,
  mealConfirmRateLimit,
  pantryMealPlanRateLimit,
  checkPremiumFeature,
  formatZodError,
  parsePositiveIntParam,
  parseQueryString,
} from "./_helpers";
import { generateMealPlanFromPantry } from "../services/pantry-meal-plan";
import { db } from "../db";
import {
  mealPlanRecipes,
  recipeIngredients,
  mealPlanItems,
} from "@shared/schema";
import { inferMealTypes } from "../services/meal-type-inference";

// Zod schemas for meal plan endpoints
const createMealPlanRecipeSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  cuisine: z.string().max(100).optional().nullable(),
  difficulty: z.string().max(50).optional().nullable(),
  servings: z.number().int().min(1).max(50).optional(),
  prepTimeMinutes: z.number().int().min(0).max(1440).optional().nullable(),
  cookTimeMinutes: z.number().int().min(0).max(1440).optional().nullable(),
  imageUrl: z.string().max(2000).optional().nullable(),
  instructions: z.string().max(10000).optional().nullable(),
  dietTags: z.array(z.string().max(50)).max(20).optional(),
  caloriesPerServing: z
    .union([z.string(), z.number()])
    .optional()
    .nullable()
    .transform((v) => v?.toString() ?? null),
  proteinPerServing: z
    .union([z.string(), z.number()])
    .optional()
    .nullable()
    .transform((v) => v?.toString() ?? null),
  carbsPerServing: z
    .union([z.string(), z.number()])
    .optional()
    .nullable()
    .transform((v) => v?.toString() ?? null),
  fatPerServing: z
    .union([z.string(), z.number()])
    .optional()
    .nullable()
    .transform((v) => v?.toString() ?? null),
  sourceType: z
    .enum(["user_created", "quick_entry", "ai_suggestion", "photo_import"])
    .optional()
    .default("user_created"),
  ingredients: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        quantity: z
          .union([z.string(), z.number()])
          .optional()
          .nullable()
          .transform((v) => v?.toString() ?? null),
        unit: z.string().max(50).optional().nullable(),
        category: z.string().max(50).optional(),
      }),
    )
    .optional(),
});

const addMealPlanItemSchema = z.object({
  recipeId: z.number().int().positive().optional().nullable(),
  scannedItemId: z.number().int().positive().optional().nullable(),
  plannedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]),
  servings: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => v?.toString()),
});

export function register(app: Express): void {
  // GET /api/meal-plan/recipes - Get user's meal plan recipes
  app.get(
    "/api/meal-plan/recipes",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const recipes = await storage.getUserMealPlanRecipes(req.userId!);
        res.json(recipes);
      } catch (error) {
        console.error("Get meal plan recipes error:", error);
        sendError(
          res,
          500,
          "Failed to fetch recipes",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // GET /api/meal-plan/recipes/:id - Get a specific recipe with ingredients
  app.get(
    "/api/meal-plan/recipes/:id",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const id = parsePositiveIntParam(req.params.id);
        if (!id) {
          sendError(res, 400, "Invalid recipe ID", ErrorCode.VALIDATION_ERROR);
          return;
        }

        const recipe = await storage.getMealPlanRecipeWithIngredients(id);
        if (!recipe || recipe.userId !== req.userId) {
          sendError(res, 404, "Recipe not found", ErrorCode.NOT_FOUND);
          return;
        }

        res.json(recipe);
      } catch (error) {
        console.error("Get meal plan recipe error:", error);
        sendError(res, 500, "Failed to fetch recipe", ErrorCode.INTERNAL_ERROR);
      }
    },
  );

  // POST /api/meal-plan/recipes - Create a meal plan recipe
  app.post(
    "/api/meal-plan/recipes",
    requireAuth,
    mealPlanRateLimit,
    async (req: Request, res: Response): Promise<void> => {
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

        const { ingredients, sourceType, ...recipeData } = parsed.data;
        // Infer meal types from title + ingredients (moved from storage layer to maintain layering)
        const mealTypes = inferMealTypes(
          recipeData.title,
          ingredients?.map((i) => i.name),
        );
        const recipe = await storage.createMealPlanRecipe(
          { ...recipeData, userId: req.userId!, sourceType, mealTypes },
          ingredients?.map((ing) => ({
            ...ing,
            recipeId: 0, // Will be set by storage method
          })),
        );

        res.status(201).json(recipe);
      } catch (error) {
        if (error instanceof ZodError) {
          sendError(
            res,
            400,
            formatZodError(error),
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }
        console.error("Create meal plan recipe error:", error);
        sendError(
          res,
          500,
          "Failed to create recipe",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // PUT /api/meal-plan/recipes/:id - Update a recipe
  app.put(
    "/api/meal-plan/recipes/:id",
    requireAuth,
    mealPlanRateLimit,
    async (req: Request, res: Response): Promise<void> => {
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
          req.userId!,
          parsed.data,
        );
        if (!recipe) {
          sendError(res, 404, "Recipe not found", ErrorCode.NOT_FOUND);
          return;
        }

        res.json(recipe);
      } catch (error) {
        if (error instanceof ZodError) {
          sendError(
            res,
            400,
            formatZodError(error),
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }
        console.error("Update meal plan recipe error:", error);
        sendError(
          res,
          500,
          "Failed to update recipe",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // DELETE /api/meal-plan/recipes/:id - Delete a recipe
  app.delete(
    "/api/meal-plan/recipes/:id",
    requireAuth,
    mealPlanRateLimit,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const id = parsePositiveIntParam(req.params.id);
        if (!id) {
          sendError(res, 400, "Invalid recipe ID", ErrorCode.VALIDATION_ERROR);
          return;
        }

        const deleted = await storage.deleteMealPlanRecipe(id, req.userId!);
        if (!deleted) {
          sendError(res, 404, "Recipe not found", ErrorCode.NOT_FOUND);
          return;
        }

        res.status(204).send();
      } catch (error) {
        console.error("Delete meal plan recipe error:", error);
        sendError(
          res,
          500,
          "Failed to delete recipe",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // GET /api/meal-plan - Get meal plan items for a date range
  app.get(
    "/api/meal-plan",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const start = parseQueryString(req.query.start);
        const end = parseQueryString(req.query.end);

        if (
          !start ||
          !end ||
          !/^\d{4}-\d{2}-\d{2}$/.test(start) ||
          !/^\d{4}-\d{2}-\d{2}$/.test(end)
        ) {
          sendError(
            res,
            400,
            "start and end query parameters required (YYYY-MM-DD)",
          );
          return;
        }

        // Validate that the strings represent real calendar dates
        if (!isValidCalendarDate(start) || !isValidCalendarDate(end)) {
          sendError(
            res,
            400,
            "Invalid calendar date",
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        // Validate start <= end
        if (start > end) {
          sendError(
            res,
            400,
            "start must be on or before end",
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        // Validate max range of 90 days
        const startMs = new Date(start + "T00:00:00Z").getTime();
        const endMs = new Date(end + "T00:00:00Z").getTime();
        const diffDays = (endMs - startMs) / (1000 * 60 * 60 * 24);
        if (diffDays > 90) {
          sendError(
            res,
            400,
            "Date range must not exceed 90 days",
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        const items = await storage.getMealPlanItems(req.userId!, start, end);
        res.json(items);
      } catch (error) {
        console.error("Get meal plan error:", error);
        sendError(
          res,
          500,
          "Failed to fetch meal plan",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // POST /api/meal-plan/items - Add item to meal plan
  app.post(
    "/api/meal-plan/items",
    requireAuth,
    mealPlanRateLimit,
    async (req: Request, res: Response): Promise<void> => {
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

        if (!parsed.data.recipeId && !parsed.data.scannedItemId) {
          sendError(
            res,
            400,
            "Either recipeId or scannedItemId is required",
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        // IDOR: verify recipe or scanned item belongs to user
        if (parsed.data.recipeId) {
          const recipe = await storage.getMealPlanRecipe(parsed.data.recipeId);
          if (!recipe || recipe.userId !== req.userId) {
            sendError(res, 404, "Recipe not found", ErrorCode.NOT_FOUND);
            return;
          }
        }
        if (parsed.data.scannedItemId) {
          const item = await storage.getScannedItem(
            parsed.data.scannedItemId,
            req.userId!,
          );
          if (!item) {
            sendError(res, 404, "Scanned item not found", ErrorCode.NOT_FOUND);
            return;
          }
        }

        const mealPlanItem = await storage.addMealPlanItem({
          ...parsed.data,
          userId: req.userId!,
        });

        res.status(201).json(mealPlanItem);
      } catch (error) {
        if (error instanceof ZodError) {
          sendError(
            res,
            400,
            formatZodError(error),
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }
        console.error("Add meal plan item error:", error);
        sendError(
          res,
          500,
          "Failed to add item to plan",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // DELETE /api/meal-plan/items/:id - Remove item from meal plan
  app.delete(
    "/api/meal-plan/items/:id",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const id = parsePositiveIntParam(req.params.id);
        if (!id) {
          sendError(res, 400, "Invalid item ID", ErrorCode.VALIDATION_ERROR);
          return;
        }

        const removed = await storage.removeMealPlanItem(id, req.userId!);
        if (!removed) {
          sendError(res, 404, "Item not found", ErrorCode.NOT_FOUND);
          return;
        }

        res.status(204).send();
      } catch (error) {
        console.error("Remove meal plan item error:", error);
        sendError(res, 500, "Failed to remove item", ErrorCode.INTERNAL_ERROR);
      }
    },
  );

  // PATCH /api/meal-plan/reorder - Reorder meal plan items
  app.patch(
    "/api/meal-plan/reorder",
    requireAuth,
    mealPlanRateLimit,
    async (req: Request, res: Response): Promise<void> => {
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

        await storage.reorderMealPlanItems(req.userId!, items);

        res.status(200).json({ success: true });
      } catch (error) {
        if (error instanceof ZodError) {
          sendError(
            res,
            400,
            formatZodError(error),
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }
        console.error("Reorder meal plan items error:", error);
        sendError(
          res,
          500,
          "Failed to reorder items",
          ErrorCode.INTERNAL_ERROR,
        );
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
    async (req: Request, res: Response): Promise<void> => {
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
        const mealPlanItem = await storage.getMealPlanItemById(id, req.userId!);
        if (!mealPlanItem) {
          sendError(res, 404, "Meal plan item not found", ErrorCode.NOT_FOUND);
          return;
        }

        // Check for duplicate confirmation
        const confirmedIds = await storage.getConfirmedMealPlanItemIds(
          req.userId!,
          new Date(mealPlanItem.plannedDate),
        );
        if (confirmedIds.includes(id)) {
          sendError(
            res,
            409,
            "Meal plan item already confirmed",
            "ALREADY_CONFIRMED",
          );
          return;
        }

        // Create daily log entry
        const dailyLog = await storage.createDailyLog({
          userId: req.userId!,
          scannedItemId: mealPlanItem.scannedItemId || null,
          recipeId: mealPlanItem.recipeId || null,
          mealPlanItemId: mealPlanItem.id,
          source: "meal_plan_confirm",
          servings: mealPlanItem.servings || "1",
          mealType: mealPlanItem.mealType,
        });

        res.status(201).json(dailyLog);
      } catch (error) {
        console.error("Meal confirmation error:", error);
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
    async (req: Request, res: Response): Promise<void> => {
      try {
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

        // Fetch pantry items
        const pantryItems = await storage.getPantryItems(req.userId!);
        if (pantryItems.length === 0) {
          sendError(
            res,
            400,
            "No pantry items available. Add items to your pantry first.",
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        // Fetch user profile and goals
        const [userProfile, user] = await Promise.all([
          storage.getUserProfile(req.userId!),
          storage.getUser(req.userId!),
        ]);

        const dailyTargets = {
          calories: user?.dailyCalorieGoal ?? 2000,
          protein: user?.dailyProteinGoal ?? 150,
          carbs: user?.dailyCarbsGoal ?? 250,
          fat: user?.dailyFatGoal ?? 67,
        };

        const householdSize =
          (userProfile as { householdSize?: number } | null)?.householdSize ??
          1;

        const plan = await generateMealPlanFromPantry({
          pantryItems,
          userProfile: userProfile ?? null,
          dailyTargets,
          days: parsed.data.days,
          householdSize,
        });

        res.json(plan);
      } catch (error) {
        console.error("Generate meal plan from pantry error:", error);
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
    async (req: Request, res: Response): Promise<void> => {
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
          instructions: z.string().max(10000).optional(),
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
        const createdItems = await db.transaction(async (tx) => {
          const items: { recipeId: number; mealPlanItemId: number }[] = [];

          for (const meal of parsed.data.meals) {
            const mealTypes = inferMealTypes(
              meal.title,
              meal.ingredients.map((i) => i.name),
            );

            const [recipe] = await tx
              .insert(mealPlanRecipes)
              .values({
                userId: req.userId!,
                title: meal.title,
                description: meal.description ?? null,
                difficulty: meal.difficulty ?? null,
                servings: meal.servings,
                prepTimeMinutes: meal.prepTimeMinutes,
                cookTimeMinutes: meal.cookTimeMinutes,
                instructions: meal.instructions ?? null,
                dietTags: meal.dietTags ?? [],
                caloriesPerServing: String(meal.caloriesPerServing),
                proteinPerServing: String(meal.proteinPerServing),
                carbsPerServing: String(meal.carbsPerServing),
                fatPerServing: String(meal.fatPerServing),
                sourceType: "ai_suggestion",
                mealTypes,
              })
              .returning();

            if (meal.ingredients.length > 0) {
              await tx.insert(recipeIngredients).values(
                meal.ingredients.map((ing, idx) => ({
                  recipeId: recipe.id,
                  name: ing.name,
                  quantity: ing.quantity ?? null,
                  unit: ing.unit ?? null,
                  displayOrder: idx,
                })),
              );
            }

            const [mealPlanItem] = await tx
              .insert(mealPlanItems)
              .values({
                userId: req.userId!,
                recipeId: recipe.id,
                plannedDate: meal.plannedDate,
                mealType: meal.mealType,
                servings: String(meal.servings),
              })
              .returning();

            items.push({
              recipeId: recipe.id,
              mealPlanItemId: mealPlanItem.id,
            });
          }

          return items;
        });

        res.status(201).json({
          saved: createdItems.length,
          items: createdItems,
        });
      } catch (error) {
        if (error instanceof ZodError) {
          sendError(
            res,
            400,
            formatZodError(error),
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }
        console.error("Save generated meal plan error:", error);
        sendError(
          res,
          500,
          "Failed to save meal plan",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );
}
