import type { Express, Request, Response } from "express";
import { z, ZodError } from "zod";
import { storage } from "../storage";
import { requireAuth } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { TIER_FEATURES, isValidSubscriptionTier } from "@shared/types/premium";
import { isValidCalendarDate } from "../utils/date-validation";
import {
  generateGroceryItems,
  flagAllergenicGroceryItems,
} from "../services/grocery-generation";
import { deductPantryFromGrocery } from "../services/pantry-deduction";
import { parseUserAllergies } from "@shared/constants/allergens";
import {
  mealPlanRateLimit,
  pantryRateLimit,
  checkPremiumFeature,
  formatZodError,
  parsePositiveIntParam,
  parseQueryInt,
} from "./_helpers";

const generateGroceryListSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string().min(1).max(200).optional(),
  deductPantry: z.boolean().optional(),
});

const addManualGroceryItemSchema = z.object({
  name: z.string().min(1).max(200),
  quantity: z
    .union([z.string(), z.number()])
    .optional()
    .nullable()
    .transform((v) => v?.toString() ?? null),
  unit: z.string().max(50).optional().nullable(),
  category: z.string().max(50).optional().default("other"),
});

export function register(app: Express): void {
  // POST /api/meal-plan/grocery-lists — Generate grocery list from date range
  app.post(
    "/api/meal-plan/grocery-lists",
    requireAuth,
    mealPlanRateLimit,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const parsed = generateGroceryListSchema.safeParse(req.body);
        if (!parsed.success) {
          sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        if (
          !isValidCalendarDate(parsed.data.startDate) ||
          !isValidCalendarDate(parsed.data.endDate)
        ) {
          sendError(
            res,
            400,
            "Invalid date format",
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        if (parsed.data.startDate > parsed.data.endDate) {
          sendError(
            res,
            400,
            "Start date must be before end date",
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        // Enforce date range limit based on subscription tier
        const subscription = await storage.getSubscriptionStatus(req.userId!);
        const tierValue = subscription?.tier || "free";
        const tier = isValidSubscriptionTier(tierValue) ? tierValue : "free";
        const maxDays = TIER_FEATURES[tier].extendedPlanRange ? 90 : 7;
        const start = new Date(parsed.data.startDate);
        const end = new Date(parsed.data.endDate);
        const daysDiff = Math.ceil(
          (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24),
        );
        if (daysDiff > maxDays) {
          sendError(
            res,
            403,
            `Date range limited to ${maxDays} days on ${tier} plan`,
            "DATE_RANGE_LIMIT",
          );
          return;
        }

        // Fetch ingredients from planned meals
        const ingredients = await storage.getMealPlanIngredientsForDateRange(
          req.userId!,
          parsed.data.startDate,
          parsed.data.endDate,
        );

        // Aggregate
        let aggregated = generateGroceryItems(ingredients);

        // Optionally deduct pantry items (premium feature)
        if (parsed.data.deductPantry) {
          const subscription = await storage.getSubscriptionStatus(req.userId!);
          const tier = subscription?.tier || "free";
          const features =
            TIER_FEATURES[isValidSubscriptionTier(tier) ? tier : "free"];
          if (features.pantryTracking) {
            const userPantry = await storage.getPantryItems(req.userId!);
            aggregated = deductPantryFromGrocery(aggregated, userPantry);
          }
        }

        // Default title
        const title =
          parsed.data.title ||
          `Grocery List ${parsed.data.startDate} to ${parsed.data.endDate}`;

        // Atomically check count + create list + insert items (TOCTOU-safe)
        const result = await storage.createGroceryListWithLimitCheck(
          {
            userId: req.userId!,
            title,
            dateRangeStart: parsed.data.startDate,
            dateRangeEnd: parsed.data.endDate,
          },
          aggregated.map((agg) => ({
            name: agg.name,
            quantity: agg.quantity?.toString() || null,
            unit: agg.unit,
            category: agg.category,
          })),
          50,
        );

        if (!result) {
          sendError(
            res,
            400,
            "Maximum of 50 grocery lists reached",
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        res.status(201).json({ ...result.list, items: result.items });
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
        console.error("Generate grocery list error:", error);
        sendError(
          res,
          500,
          "Failed to generate grocery list",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // GET /api/meal-plan/grocery-lists — List user's grocery lists
  app.get(
    "/api/meal-plan/grocery-lists",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const limit = parseQueryInt(req.query.limit, { default: 50, max: 100 });
        const lists = await storage.getGroceryLists(req.userId!, limit);
        res.json(lists);
      } catch (error) {
        console.error("Get grocery lists error:", error);
        sendError(
          res,
          500,
          "Failed to fetch grocery lists",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // GET /api/meal-plan/grocery-lists/:id — Get list with items
  app.get(
    "/api/meal-plan/grocery-lists/:id",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const id = parsePositiveIntParam(req.params.id);
        if (!id) {
          sendError(res, 400, "Invalid list ID", ErrorCode.VALIDATION_ERROR);
          return;
        }

        const list = await storage.getGroceryListWithItems(id, req.userId!);
        if (!list) {
          sendError(res, 404, "Grocery list not found", ErrorCode.NOT_FOUND);
          return;
        }

        // Enrich with allergen flags if user has allergies
        const profile = await storage.getUserProfile(req.userId!);
        const userAllergies = parseUserAllergies(profile?.allergies);

        let allergenFlags: Record<
          string,
          { allergenId: string; severity: string }
        > = {};
        if (userAllergies.length > 0 && list.items) {
          const flagMap = flagAllergenicGroceryItems(
            list.items.map((i: { name: string }) => ({
              name: i.name,
              quantity: null,
              unit: null,
              category: "",
            })),
            userAllergies,
          );
          for (const [name, match] of flagMap) {
            allergenFlags[name] = {
              allergenId: match.allergenId,
              severity: match.severity,
            };
          }
        }

        res.json({ ...list, allergenFlags });
      } catch (error) {
        console.error("Get grocery list error:", error);
        sendError(
          res,
          500,
          "Failed to fetch grocery list",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // PUT /api/meal-plan/grocery-lists/:id/items/:itemId — Toggle item checked
  app.put(
    "/api/meal-plan/grocery-lists/:id/items/:itemId",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const listId = parsePositiveIntParam(req.params.id);
        const itemId = parsePositiveIntParam(req.params.itemId);
        if (!listId || !itemId) {
          sendError(res, 400, "Invalid ID", ErrorCode.VALIDATION_ERROR);
          return;
        }

        // IDOR: verify list belongs to user
        const list = await storage.getGroceryListWithItems(listId, req.userId!);
        if (!list) {
          sendError(res, 404, "Grocery list not found", ErrorCode.NOT_FOUND);
          return;
        }

        // Handle isChecked toggle
        if (typeof req.body.isChecked === "boolean") {
          const updated = await storage.updateGroceryListItemChecked(
            itemId,
            listId,
            req.body.isChecked,
          );
          if (!updated) {
            sendError(res, 404, "Item not found", ErrorCode.NOT_FOUND);
            return;
          }
          // Also handle addedToPantry if provided in same request
          if (typeof req.body.addedToPantry === "boolean") {
            const flagged = await storage.updateGroceryListItemPantryFlag(
              itemId,
              listId,
              req.body.addedToPantry,
            );
            if (flagged) {
              res.json(flagged);
              return;
            }
          }
          res.json(updated);
          return;
        }

        // Handle addedToPantry flag only
        if (typeof req.body.addedToPantry === "boolean") {
          const updated = await storage.updateGroceryListItemPantryFlag(
            itemId,
            listId,
            req.body.addedToPantry,
          );
          if (!updated) {
            sendError(res, 404, "Item not found", ErrorCode.NOT_FOUND);
            return;
          }
          res.json(updated);
          return;
        }

        sendError(
          res,
          400,
          "No update fields provided",
          ErrorCode.VALIDATION_ERROR,
        );
      } catch (error) {
        console.error("Toggle grocery item error:", error);
        sendError(res, 500, "Failed to update item", ErrorCode.INTERNAL_ERROR);
      }
    },
  );

  // POST /api/meal-plan/grocery-lists/:id/items/:itemId/add-to-pantry — Atomic grocery->pantry
  app.post(
    "/api/meal-plan/grocery-lists/:id/items/:itemId/add-to-pantry",
    requireAuth,
    pantryRateLimit,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "pantryTracking",
          "Pantry tracking",
        );
        if (!features) return;

        const listId = parsePositiveIntParam(req.params.id);
        const itemId = parsePositiveIntParam(req.params.itemId);
        if (!listId || !itemId) {
          sendError(res, 400, "Invalid ID", ErrorCode.VALIDATION_ERROR);
          return;
        }

        // IDOR: verify list belongs to user
        const list = await storage.getGroceryListWithItems(listId, req.userId!);
        if (!list) {
          sendError(res, 404, "Grocery list not found", ErrorCode.NOT_FOUND);
          return;
        }

        const groceryItem = list.items.find((i) => i.id === itemId);
        if (!groceryItem) {
          sendError(res, 404, "Grocery item not found", ErrorCode.NOT_FOUND);
          return;
        }

        // Create pantry item from grocery item data
        const pantryItem = await storage.createPantryItem({
          userId: req.userId!,
          name: groceryItem.name,
          quantity: groceryItem.quantity,
          unit: groceryItem.unit || null,
          category: groceryItem.category || "other",
          expiresAt: null,
        });

        // Flag grocery item as added to pantry
        await storage.updateGroceryListItemPantryFlag(itemId, listId, true);

        res.status(201).json(pantryItem);
      } catch (error) {
        console.error("Add grocery item to pantry error:", error);
        sendError(
          res,
          500,
          "Failed to add item to pantry",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // POST /api/meal-plan/grocery-lists/:id/items — Add manual item
  app.post(
    "/api/meal-plan/grocery-lists/:id/items",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const listId = parsePositiveIntParam(req.params.id);
        if (!listId) {
          sendError(res, 400, "Invalid list ID", ErrorCode.VALIDATION_ERROR);
          return;
        }

        // IDOR: verify list belongs to user
        const list = await storage.getGroceryListWithItems(listId, req.userId!);
        if (!list) {
          sendError(res, 404, "Grocery list not found", ErrorCode.NOT_FOUND);
          return;
        }

        const parsed = addManualGroceryItemSchema.safeParse(req.body);
        if (!parsed.success) {
          sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        const item = await storage.addGroceryListItem({
          groceryListId: listId,
          name: parsed.data.name,
          quantity: parsed.data.quantity,
          unit: parsed.data.unit || null,
          category: parsed.data.category || "other",
          isManual: true,
        });

        res.status(201).json(item);
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
        console.error("Add grocery item error:", error);
        sendError(res, 500, "Failed to add item", ErrorCode.INTERNAL_ERROR);
      }
    },
  );

  // DELETE /api/meal-plan/grocery-lists/:id — Delete grocery list
  app.delete(
    "/api/meal-plan/grocery-lists/:id",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const id = parsePositiveIntParam(req.params.id);
        if (!id) {
          sendError(res, 400, "Invalid list ID", ErrorCode.VALIDATION_ERROR);
          return;
        }

        const deleted = await storage.deleteGroceryList(id, req.userId!);
        if (!deleted) {
          sendError(res, 404, "Grocery list not found", ErrorCode.NOT_FOUND);
          return;
        }

        res.status(204).send();
      } catch (error) {
        console.error("Delete grocery list error:", error);
        sendError(
          res,
          500,
          "Failed to delete grocery list",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );
}
