import type { Express, Request, Response } from "express";
import { z, ZodError } from "zod";
import { storage } from "../storage";
import { requireAuth } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { insertScannedItemSchema } from "@shared/schema";
import { lookupNutrition, lookupBarcode } from "../services/nutrition-lookup";
import {
  nutritionLookupRateLimit,
  pantryRateLimit,
  formatZodError,
  parsePositiveIntParam,
  parseQueryInt,
  parseQueryDate,
  parseQueryString,
} from "./_helpers";

// Coerce literal "null" strings to actual null
const nullishString = z
  .string()
  .optional()
  .nullable()
  .transform((v) => (v === "null" || v === "undefined" || v === "" ? null : v));

// Extended schema for scanned items with string coercion for numeric fields
const scannedItemInputSchema = insertScannedItemSchema.extend({
  productName: z
    .string()
    .min(1, "Product name is required")
    .default("Unknown Product"),
  brandName: nullishString,
  servingSize: nullishString,
  calories: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => v?.toString()),
  protein: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => v?.toString()),
  carbs: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => v?.toString()),
  fat: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => v?.toString()),
  fiber: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => v?.toString()),
  sugar: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => v?.toString()),
  sodium: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => v?.toString()),
});

export function register(app: Express): void {
  // Nutrition lookup by product name — used as fallback when OpenFoodFacts
  // returns only per-100g data without serving size information.
  app.get(
    "/api/nutrition/lookup",
    requireAuth,
    nutritionLookupRateLimit,
    async (req: Request, res: Response) => {
      const name = parseQueryString(req.query.name)?.trim();
      if (!name || name.length > 200) {
        sendError(
          res,
          400,
          "name query parameter is required (max 200 chars)",
          ErrorCode.VALIDATION_ERROR,
        );
        return;
      }

      try {
        const result = await lookupNutrition(name);
        if (!result) {
          sendError(res, 404, "Nutrition data not found", ErrorCode.NOT_FOUND);
          return;
        }
        res.json(result);
      } catch (error) {
        console.error("Nutrition lookup error:", error);
        sendError(
          res,
          500,
          "Nutrition lookup failed",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // Barcode nutrition lookup — fetches Open Food Facts product data and
  // cross-validates per-100g values with USDA FoodData Central.
  // This catches bad OFF data (e.g. sugar showing 50 kcal/100g when USDA says 375).
  app.get(
    "/api/nutrition/barcode/:code",
    requireAuth,
    nutritionLookupRateLimit,
    async (req: Request, res: Response) => {
      const rawCode = req.params.code;
      const code = typeof rawCode === "string" ? rawCode.trim() : "";
      if (!code || code.length > 50 || !/^\d+$/.test(code)) {
        sendError(res, 400, "Invalid barcode", ErrorCode.VALIDATION_ERROR);
        return;
      }

      try {
        const result = await lookupBarcode(code);
        if (!result) {
          sendError(res, 404, "Product not found", "NOT_IN_DATABASE");
          return;
        }

        // Include verification status alongside nutrition data
        const verification = await storage.getVerification(code);
        res.json({
          ...result,
          verificationLevel: verification?.verificationLevel ?? "unverified",
          verificationCount: verification?.verificationCount ?? 0,
        });
      } catch (error) {
        console.error("Barcode lookup error:", error);
        sendError(res, 500, "Barcode lookup failed", ErrorCode.INTERNAL_ERROR);
      }
    },
  );

  // Frequently logged items for Quick Log suggestions
  app.get(
    "/api/scanned-items/frequent",
    requireAuth,
    pantryRateLimit,
    async (req: Request, res: Response) => {
      try {
        const limit = parseQueryInt(req.query.limit, {
          default: 5,
          min: 1,
          max: 20,
        });

        const items = await storage.getFrequentItems(req.userId!, limit);
        res.json({ items });
      } catch (error) {
        console.error("Error fetching frequent items:", error);
        sendError(
          res,
          500,
          "Failed to fetch frequent items",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  app.get(
    "/api/scanned-items",
    requireAuth,
    pantryRateLimit,
    async (req: Request, res: Response) => {
      try {
        const limit = parseQueryInt(req.query.limit, {
          default: 50,
          min: 1,
          max: 100,
        });
        const offset = parseQueryInt(req.query.offset, { default: 0, min: 0 });

        const result = await storage.getScannedItems(
          req.userId!,
          limit,
          offset,
        );
        res.json(result);
      } catch (error) {
        console.error("Error fetching scanned items:", error);
        sendError(res, 500, "Failed to fetch items", ErrorCode.INTERNAL_ERROR);
      }
    },
  );

  app.get(
    "/api/scanned-items/:id",
    requireAuth,
    pantryRateLimit,
    async (req: Request, res: Response) => {
      try {
        const id = parsePositiveIntParam(req.params.id);
        if (!id) {
          return sendError(
            res,
            400,
            "Invalid item ID",
            ErrorCode.VALIDATION_ERROR,
          );
        }

        const item = await storage.getScannedItemWithFavourite(id, req.userId!);

        if (!item || item.userId !== req.userId) {
          return sendError(res, 404, "Item not found", ErrorCode.NOT_FOUND);
        }

        res.json(item);
      } catch (error) {
        console.error("Error fetching scanned item:", error);
        sendError(res, 500, "Failed to fetch item", ErrorCode.INTERNAL_ERROR);
      }
    },
  );

  app.post(
    "/api/scanned-items",
    requireAuth,
    pantryRateLimit,
    async (req: Request, res: Response) => {
      try {
        const validated = scannedItemInputSchema.parse({
          ...req.body,
          userId: req.userId!,
        });

        // No logOverrides needed — defaults to source: "scan", mealType: null
        const item = await storage.createScannedItemWithLog({
          userId: validated.userId,
          barcode: validated.barcode,
          productName: validated.productName,
          brandName: validated.brandName,
          servingSize: validated.servingSize,
          calories: validated.calories,
          protein: validated.protein,
          carbs: validated.carbs,
          fat: validated.fat,
          fiber: validated.fiber,
          sugar: validated.sugar,
          sodium: validated.sodium,
          imageUrl: validated.imageUrl,
        });

        res.status(201).json(item);
      } catch (error) {
        if (error instanceof ZodError) {
          return sendError(
            res,
            400,
            formatZodError(error),
            ErrorCode.VALIDATION_ERROR,
          );
        }
        console.error("Error creating scanned item:", error);
        sendError(res, 500, "Failed to save item", ErrorCode.INTERNAL_ERROR);
      }
    },
  );

  // Toggle favourite on a scanned item
  app.post(
    "/api/scanned-items/:id/favourite",
    requireAuth,
    pantryRateLimit,
    async (req: Request, res: Response) => {
      try {
        const id = parsePositiveIntParam(req.params.id);
        if (!id) {
          return sendError(res, 400, "Invalid item ID", "INVALID_ITEM_ID");
        }

        // Ownership + discardedAt check is done inside the transaction
        // to close the TOCTOU gap (see storage.toggleFavouriteScannedItem).
        const isFavourited = await storage.toggleFavouriteScannedItem(
          id,
          req.userId!,
        );

        if (isFavourited === null) {
          return sendError(res, 404, "Item not found", "ITEM_NOT_FOUND");
        }

        res.json({ isFavourited });
      } catch (error) {
        console.error("Error toggling favourite:", error);
        sendError(
          res,
          500,
          "Failed to toggle favourite",
          "TOGGLE_FAVOURITE_FAILED",
        );
      }
    },
  );

  // Soft delete (discard) a scanned item
  app.delete(
    "/api/scanned-items/:id",
    requireAuth,
    pantryRateLimit,
    async (req: Request, res: Response) => {
      try {
        const id = parsePositiveIntParam(req.params.id);
        if (!id) {
          return sendError(res, 400, "Invalid item ID", "INVALID_ITEM_ID");
        }

        const deleted = await storage.softDeleteScannedItem(id, req.userId!);
        if (!deleted) {
          return sendError(res, 404, "Item not found", "ITEM_NOT_FOUND");
        }

        res.status(204).send();
      } catch (error) {
        console.error("Error discarding scanned item:", error);
        sendError(res, 500, "Failed to discard item", "DISCARD_ITEM_FAILED");
      }
    },
  );

  app.get(
    "/api/daily-summary",
    requireAuth,
    pantryRateLimit,
    async (req: Request, res: Response) => {
      try {
        const date = parseQueryDate(req.query.date) ?? new Date();

        const [summary, confirmedIds] = await Promise.all([
          storage.getDailySummary(req.userId!, date),
          storage.getConfirmedMealPlanItemIds(req.userId!, date),
        ]);
        const planned = await storage.getPlannedNutritionSummary(
          req.userId!,
          date,
          confirmedIds,
        );
        res.json({
          ...summary,
          ...planned,
          confirmedMealPlanItemIds: confirmedIds,
        });
      } catch (error) {
        console.error("Error fetching daily summary:", error);
        sendError(
          res,
          500,
          "Failed to fetch summary",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );
}
