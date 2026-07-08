import type { Express, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { TIER_FEATURES, applyStreakUnlocks } from "@shared/types/premium";
import { resolveVerificationStreak } from "../services/verification-streak-cache";
import { isValidCalendarDate } from "../utils/date-validation";
import {
  generateGroceryItems,
  flagAllergenicGroceryItems,
} from "../services/grocery-generation";
import { deductPantryFromGrocery } from "../services/pantry-deduction";
import { parseUserAllergies } from "@shared/constants/allergens";
import { markDynamicKeyFields } from "../lib/dynamic-key-fields";
import {
  crudRateLimit,
  mealPlanRateLimit,
  pantryRateLimit,
} from "./_rate-limiters";
import { nullableNumericStringField } from "./_schemas";
import {
  checkPremiumFeature,
  formatZodError,
  handleRouteError,
  parsePositiveIntParam,
  parseQueryInt,
} from "./_helpers";

const generateGroceryListSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string().min(1).max(200).optional(),
  deductPantry: z.boolean().optional(),
});

const groceryItemUpdateSchema = z
  .object({
    isChecked: z.boolean().optional(),
    addedToPantry: z.boolean().optional(),
  })
  .refine(
    (data) => data.isChecked !== undefined || data.addedToPantry !== undefined,
    {
      message: "At least one of isChecked or addedToPantry must be provided",
    },
  );

const addManualGroceryItemSchema = z.object({
  name: z.string().min(1).max(200),
  quantity: nullableNumericStringField,
  unit: z.string().max(50).optional().nullable(),
  category: z.string().max(50).optional().default("other"),
});

export function register(app: Express): void {
  // POST /api/meal-plan/grocery-lists — Generate grocery list from date range
  app.post(
    "/api/meal-plan/grocery-lists",
    requireAuth,
    mealPlanRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
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

        // Enforce date range limit based on subscription tier. A verification
        // streak can unlock extendedPlanRange for free-tier users, so the
        // feature set is resolved through applyStreakUnlocks. Tier resolution
        // (including expired-premium downgrade) goes through the canonical
        // `getEffectiveTierForUser` helper.
        const [effectiveTier, streak] = await Promise.all([
          storage.getEffectiveTierForUser(req.userId),
          resolveVerificationStreak(req.userId),
        ]);
        const features = applyStreakUnlocks(
          TIER_FEATURES[effectiveTier],
          streak,
        );
        const maxDays = features.extendedPlanRange ? 90 : 7;
        const start = new Date(parsed.data.startDate);
        const end = new Date(parsed.data.endDate);
        const daysDiff = Math.ceil(
          (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24),
        );
        if (daysDiff > maxDays) {
          sendError(
            res,
            403,
            `Date range limited to ${maxDays} days on ${effectiveTier} plan`,
            ErrorCode.DATE_RANGE_LIMIT,
          );
          return;
        }

        // Fetch ingredients from planned meals
        const ingredients = await storage.getMealPlanIngredientsForDateRange(
          req.userId,
          parsed.data.startDate,
          parsed.data.endDate,
        );

        // Aggregate
        let aggregated = generateGroceryItems(ingredients);

        // Optionally deduct pantry items (premium feature)
        if (parsed.data.deductPantry) {
          if (TIER_FEATURES[effectiveTier].pantryTracking) {
            const userPantry = await storage.getPantryItems(req.userId);
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
            userId: req.userId,
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
        handleRouteError(res, error, "generate grocery list");
      }
    },
  );

  // GET /api/meal-plan/grocery-lists — List user's grocery lists
  app.get(
    "/api/meal-plan/grocery-lists",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const limit = parseQueryInt(req.query.limit, { default: 50, max: 100 });
        const lists = await storage.getGroceryLists(req.userId, limit);
        res.json(lists);
      } catch (error) {
        handleRouteError(res, error, "fetch grocery lists");
      }
    },
  );

  // GET /api/meal-plan/grocery-lists/:id — Get list with items
  app.get(
    "/api/meal-plan/grocery-lists/:id",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const id = parsePositiveIntParam(req.params.id);
        if (!id) {
          sendError(res, 400, "Invalid list ID", ErrorCode.VALIDATION_ERROR);
          return;
        }

        const list = await storage.getGroceryListWithItems(id, req.userId);
        if (!list) {
          sendError(res, 404, "Grocery list not found", ErrorCode.NOT_FOUND);
          return;
        }

        // Enrich with allergen flags if user has allergies
        const profile = await storage.getUserProfile(req.userId);
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

        // Tell the (dev-only, opt-in) contract-snapshot tool that allergenFlags is a
        // dynamically-keyed map (keyed by grocery-item name) even at the single-entry
        // or all-primitive-valued shapes its own heuristics alone would miss — see
        // server/lib/dynamic-key-fields.ts and
        // docs/solutions/conventions/redact-dynamic-object-keys-not-just-values-2026-07-07.md.
        // No-op when the snapshot middleware isn't installed (prod, or CONTRACT_SNAPSHOT
        // unset) — this never affects the response actually sent below.
        markDynamicKeyFields(res, ["allergenFlags"]);
        res.json({ ...list, allergenFlags });
      } catch (error) {
        handleRouteError(res, error, "fetch grocery list");
      }
    },
  );

  // PUT /api/meal-plan/grocery-lists/:id/items/:itemId — Toggle item checked
  app.put(
    "/api/meal-plan/grocery-lists/:id/items/:itemId",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const listId = parsePositiveIntParam(req.params.id);
        const itemId = parsePositiveIntParam(req.params.itemId);
        if (!listId || !itemId) {
          sendError(res, 400, "Invalid ID", ErrorCode.VALIDATION_ERROR);
          return;
        }

        // IDOR: verify list belongs to user (lightweight — no item fetch)
        const ownsList = await storage.verifyGroceryListOwnership(
          listId,
          req.userId,
        );
        if (!ownsList) {
          sendError(res, 404, "Grocery list not found", ErrorCode.NOT_FOUND);
          return;
        }

        const parsed = groceryItemUpdateSchema.safeParse(req.body);
        if (!parsed.success) {
          sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        // Handle isChecked toggle
        if (parsed.data.isChecked !== undefined) {
          const updated = await storage.updateGroceryListItemChecked(
            itemId,
            listId,
            parsed.data.isChecked,
            req.userId,
          );
          if (!updated) {
            sendError(res, 404, "Item not found", ErrorCode.NOT_FOUND);
            return;
          }
          // Also handle addedToPantry if provided in same request
          if (parsed.data.addedToPantry !== undefined) {
            const flagged = await storage.updateGroceryListItemPantryFlag(
              itemId,
              listId,
              parsed.data.addedToPantry,
              req.userId,
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
        if (parsed.data.addedToPantry !== undefined) {
          const updated = await storage.updateGroceryListItemPantryFlag(
            itemId,
            listId,
            parsed.data.addedToPantry,
            req.userId,
          );
          if (!updated) {
            sendError(res, 404, "Item not found", ErrorCode.NOT_FOUND);
            return;
          }
          res.json(updated);
          return;
        }
      } catch (error) {
        handleRouteError(res, error, "toggle grocery item");
      }
    },
  );

  // POST /api/meal-plan/grocery-lists/:id/items/:itemId/add-to-pantry — Atomic grocery->pantry
  app.post(
    "/api/meal-plan/grocery-lists/:id/items/:itemId/add-to-pantry",
    requireAuth,
    pantryRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
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
        const list = await storage.getGroceryListWithItems(listId, req.userId);
        if (!list) {
          sendError(res, 404, "Grocery list not found", ErrorCode.NOT_FOUND);
          return;
        }

        const groceryItem = list.items.find((i) => i.id === itemId);
        if (!groceryItem) {
          sendError(res, 404, "Grocery item not found", ErrorCode.NOT_FOUND);
          return;
        }

        // Atomically create pantry item and flag grocery item
        const pantryItem = await storage.addGroceryItemToPantryAtomically(
          {
            userId: req.userId,
            name: groceryItem.name,
            quantity: groceryItem.quantity,
            unit: groceryItem.unit || null,
            category: groceryItem.category || "other",
            expiresAt: null,
          },
          itemId,
          listId,
        );

        res.status(201).json(pantryItem);
      } catch (error) {
        handleRouteError(res, error, "add grocery item to pantry");
      }
    },
  );

  // POST /api/meal-plan/grocery-lists/:id/items — Add manual item
  app.post(
    "/api/meal-plan/grocery-lists/:id/items",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const listId = parsePositiveIntParam(req.params.id);
        if (!listId) {
          sendError(res, 400, "Invalid list ID", ErrorCode.VALIDATION_ERROR);
          return;
        }

        // IDOR: verify list belongs to user (lightweight — no item fetch)
        const ownsList = await storage.verifyGroceryListOwnership(
          listId,
          req.userId,
        );
        if (!ownsList) {
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
        handleRouteError(res, error, "add grocery item");
      }
    },
  );

  // DELETE /api/meal-plan/grocery-lists/:id — Delete grocery list
  app.delete(
    "/api/meal-plan/grocery-lists/:id",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const id = parsePositiveIntParam(req.params.id);
        if (!id) {
          sendError(res, 400, "Invalid list ID", ErrorCode.VALIDATION_ERROR);
          return;
        }

        const deleted = await storage.deleteGroceryList(id, req.userId);
        if (!deleted) {
          sendError(res, 404, "Grocery list not found", ErrorCode.NOT_FOUND);
          return;
        }

        res.status(204).send();
      } catch (error) {
        handleRouteError(res, error, "delete grocery list");
      }
    },
  );
}
