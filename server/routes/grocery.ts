import type { Express, Request, Response } from "express";
import { z, ZodError } from "zod";
import { storage } from "../storage";
import { requireAuth } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { TIER_FEATURES, isValidSubscriptionTier } from "@shared/types/premium";
import { isValidCalendarDate } from "../utils/date-validation";
import { generateGroceryItems } from "../services/grocery-generation";
import { deductPantryFromGrocery } from "../services/pantry-deduction";
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
          sendError(res, 400, formatZodError(parsed.error));
          return;
        }

        if (
          !isValidCalendarDate(parsed.data.startDate) ||
          !isValidCalendarDate(parsed.data.endDate)
        ) {
          sendError(res, 400, "Invalid date format");
          return;
        }

        if (parsed.data.startDate > parsed.data.endDate) {
          sendError(res, 400, "Start date must be before end date");
          return;
        }

        // Enforce date range limit based on subscription tier
        const user = await storage.getUser(req.userId!);
        const tier = user?.subscriptionTier || "free";
        const maxDays = TIER_FEATURES[tier as keyof typeof TIER_FEATURES]
          .extendedPlanRange
          ? 90
          : 7;
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

        // Enforce per-user grocery list limit (max 50)
        const existingLists = await storage.getGroceryLists(req.userId!);
        if (existingLists.length >= 50) {
          sendError(
            res,
            400,
            "Maximum of 50 grocery lists reached. Delete old lists first.",
            "LIST_LIMIT_REACHED",
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

        // Create list
        const list = await storage.createGroceryList({
          userId: req.userId!,
          title,
          dateRangeStart: parsed.data.startDate,
          dateRangeEnd: parsed.data.endDate,
        });

        // Create items
        const items = [];
        for (const agg of aggregated) {
          const item = await storage.addGroceryListItem({
            groceryListId: list.id,
            name: agg.name,
            quantity: agg.quantity?.toString() || null,
            unit: agg.unit,
            category: agg.category,
          });
          items.push(item);
        }

        res.status(201).json({ ...list, items });
      } catch (error) {
        if (error instanceof ZodError) {
          sendError(res, 400, formatZodError(error));
          return;
        }
        console.error("Generate grocery list error:", error);
        sendError(res, 500, "Failed to generate grocery list");
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
        sendError(res, 500, "Failed to fetch grocery lists");
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
          sendError(res, 400, "Invalid list ID");
          return;
        }

        const list = await storage.getGroceryListWithItems(id, req.userId!);
        if (!list) {
          sendError(res, 404, "Grocery list not found");
          return;
        }

        res.json(list);
      } catch (error) {
        console.error("Get grocery list error:", error);
        sendError(res, 500, "Failed to fetch grocery list");
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
          sendError(res, 400, "Invalid ID");
          return;
        }

        // IDOR: verify list belongs to user
        const list = await storage.getGroceryListWithItems(listId, req.userId!);
        if (!list) {
          sendError(res, 404, "Grocery list not found");
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
            sendError(res, 404, "Item not found");
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
            sendError(res, 404, "Item not found");
            return;
          }
          res.json(updated);
          return;
        }

        sendError(res, 400, "No update fields provided");
      } catch (error) {
        console.error("Toggle grocery item error:", error);
        sendError(res, 500, "Failed to update item");
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
          sendError(res, 400, "Invalid ID");
          return;
        }

        // IDOR: verify list belongs to user
        const list = await storage.getGroceryListWithItems(listId, req.userId!);
        if (!list) {
          sendError(res, 404, "Grocery list not found");
          return;
        }

        const groceryItem = list.items.find((i) => i.id === itemId);
        if (!groceryItem) {
          sendError(res, 404, "Grocery item not found");
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
        sendError(res, 500, "Failed to add item to pantry");
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
          sendError(res, 400, "Invalid list ID");
          return;
        }

        // IDOR: verify list belongs to user
        const list = await storage.getGroceryListWithItems(listId, req.userId!);
        if (!list) {
          sendError(res, 404, "Grocery list not found");
          return;
        }

        const parsed = addManualGroceryItemSchema.safeParse(req.body);
        if (!parsed.success) {
          sendError(res, 400, formatZodError(parsed.error));
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
          sendError(res, 400, formatZodError(error));
          return;
        }
        console.error("Add grocery item error:", error);
        sendError(res, 500, "Failed to add item");
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
          sendError(res, 400, "Invalid list ID");
          return;
        }

        const deleted = await storage.deleteGroceryList(id, req.userId!);
        if (!deleted) {
          sendError(res, 404, "Grocery list not found");
          return;
        }

        res.status(204).send();
      } catch (error) {
        console.error("Delete grocery list error:", error);
        sendError(res, 500, "Failed to delete grocery list");
      }
    },
  );
}
