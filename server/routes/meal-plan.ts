import type { Express, Request, Response } from "express";
import { z, ZodError } from "zod";
import { storage } from "../storage";
import { requireAuth } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { isValidCalendarDate } from "../utils/date-validation";
import {
  mealPlanRateLimit,
  mealConfirmRateLimit,
  checkPremiumFeature,
  formatZodError,
  parsePositiveIntParam,
} from "./_helpers";

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
        sendError(res, 500, "Failed to fetch recipes");
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
          sendError(res, 400, "Invalid recipe ID");
          return;
        }

        const recipe = await storage.getMealPlanRecipeWithIngredients(id);
        if (!recipe || recipe.userId !== req.userId) {
          sendError(res, 404, "Recipe not found");
          return;
        }

        res.json(recipe);
      } catch (error) {
        console.error("Get meal plan recipe error:", error);
        sendError(res, 500, "Failed to fetch recipe");
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
          sendError(res, 400, formatZodError(parsed.error));
          return;
        }

        const { ingredients, ...recipeData } = parsed.data;
        const recipe = await storage.createMealPlanRecipe(
          { ...recipeData, userId: req.userId!, sourceType: "user_created" },
          ingredients?.map((ing) => ({
            ...ing,
            recipeId: 0, // Will be set by storage method
          })),
        );

        res.status(201).json(recipe);
      } catch (error) {
        if (error instanceof ZodError) {
          sendError(res, 400, formatZodError(error));
          return;
        }
        console.error("Create meal plan recipe error:", error);
        sendError(res, 500, "Failed to create recipe");
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
          sendError(res, 400, "Invalid recipe ID");
          return;
        }

        const updateSchema = createMealPlanRecipeSchema
          .omit({ ingredients: true })
          .partial();
        const parsed = updateSchema.safeParse(req.body);
        if (!parsed.success) {
          sendError(res, 400, formatZodError(parsed.error));
          return;
        }

        const recipe = await storage.updateMealPlanRecipe(
          id,
          req.userId!,
          parsed.data,
        );
        if (!recipe) {
          sendError(res, 404, "Recipe not found");
          return;
        }

        res.json(recipe);
      } catch (error) {
        if (error instanceof ZodError) {
          sendError(res, 400, formatZodError(error));
          return;
        }
        console.error("Update meal plan recipe error:", error);
        sendError(res, 500, "Failed to update recipe");
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
          sendError(res, 400, "Invalid recipe ID");
          return;
        }

        const deleted = await storage.deleteMealPlanRecipe(id, req.userId!);
        if (!deleted) {
          sendError(res, 404, "Recipe not found");
          return;
        }

        res.status(204).send();
      } catch (error) {
        console.error("Delete meal plan recipe error:", error);
        sendError(res, 500, "Failed to delete recipe");
      }
    },
  );

  // GET /api/meal-plan - Get meal plan items for a date range
  app.get(
    "/api/meal-plan",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const start = req.query.start as string;
        const end = req.query.end as string;

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
          sendError(res, 400, "Invalid calendar date");
          return;
        }

        // Validate start <= end
        if (start > end) {
          sendError(res, 400, "start must be on or before end");
          return;
        }

        // Validate max range of 90 days
        const startMs = new Date(start + "T00:00:00Z").getTime();
        const endMs = new Date(end + "T00:00:00Z").getTime();
        const diffDays = (endMs - startMs) / (1000 * 60 * 60 * 24);
        if (diffDays > 90) {
          sendError(res, 400, "Date range must not exceed 90 days");
          return;
        }

        const items = await storage.getMealPlanItems(req.userId!, start, end);
        res.json(items);
      } catch (error) {
        console.error("Get meal plan error:", error);
        sendError(res, 500, "Failed to fetch meal plan");
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
          sendError(res, 400, formatZodError(parsed.error));
          return;
        }

        if (!parsed.data.recipeId && !parsed.data.scannedItemId) {
          sendError(res, 400, "Either recipeId or scannedItemId is required");
          return;
        }

        // IDOR: verify recipe or scanned item belongs to user
        if (parsed.data.recipeId) {
          const recipe = await storage.getMealPlanRecipe(parsed.data.recipeId);
          if (!recipe || recipe.userId !== req.userId) {
            sendError(res, 404, "Recipe not found");
            return;
          }
        }
        if (parsed.data.scannedItemId) {
          const item = await storage.getScannedItem(parsed.data.scannedItemId);
          if (!item || item.userId !== req.userId) {
            sendError(res, 404, "Scanned item not found");
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
          sendError(res, 400, formatZodError(error));
          return;
        }
        console.error("Add meal plan item error:", error);
        sendError(res, 500, "Failed to add item to plan");
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
          sendError(res, 400, "Invalid item ID");
          return;
        }

        const removed = await storage.removeMealPlanItem(id, req.userId!);
        if (!removed) {
          sendError(res, 404, "Item not found");
          return;
        }

        res.status(204).send();
      } catch (error) {
        console.error("Remove meal plan item error:", error);
        sendError(res, 500, "Failed to remove item");
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
          sendError(res, 400, "Invalid meal plan item ID");
          return;
        }

        // Fetch meal plan item and verify ownership (IDOR)
        const mealPlanItem = await storage.getMealPlanItemById(id, req.userId!);
        if (!mealPlanItem) {
          sendError(res, 404, "Meal plan item not found");
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
        sendError(res, 500, "Failed to confirm meal");
      }
    },
  );
}
