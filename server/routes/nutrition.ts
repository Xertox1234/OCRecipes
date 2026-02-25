import type { Express, Request, Response } from "express";
import { z, ZodError } from "zod";
import { storage } from "../storage";
import { db } from "../db";
import { requireAuth } from "../middleware/auth";
import {
  insertScannedItemSchema,
  scannedItems,
  dailyLogs,
} from "@shared/schema";
import { lookupNutrition, lookupBarcode } from "../services/nutrition-lookup";
import {
  nutritionLookupRateLimit,
  formatZodError,
  parsePositiveIntParam,
} from "./_helpers";

export function register(app: Express): void {
  // Nutrition lookup by product name — used as fallback when OpenFoodFacts
  // returns only per-100g data without serving size information.
  app.get(
    "/api/nutrition/lookup",
    requireAuth,
    nutritionLookupRateLimit,
    async (req: Request, res: Response) => {
      const name = (req.query.name as string)?.trim();
      if (!name || name.length > 200) {
        res
          .status(400)
          .json({ error: "name query parameter is required (max 200 chars)" });
        return;
      }

      try {
        const result = await lookupNutrition(name);
        if (!result) {
          res.status(404).json({ error: "Nutrition data not found" });
          return;
        }
        res.json(result);
      } catch (error) {
        console.error("Nutrition lookup error:", error);
        res.status(500).json({ error: "Nutrition lookup failed" });
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
        res.status(400).json({ error: "Invalid barcode" });
        return;
      }

      try {
        const result = await lookupBarcode(code);
        if (!result) {
          res
            .status(404)
            .json({ error: "Product not found", notInDatabase: true });
          return;
        }
        res.json(result);
      } catch (error) {
        console.error("Barcode lookup error:", error);
        res.status(500).json({ error: "Barcode lookup failed" });
      }
    },
  );

  app.get(
    "/api/scanned-items",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const limit = Math.min(
          Math.max(parseInt(req.query.limit as string) || 50, 1),
          100,
        );
        const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

        const result = await storage.getScannedItems(
          req.userId!,
          limit,
          offset,
        );
        res.json(result);
      } catch (error) {
        console.error("Error fetching scanned items:", error);
        res.status(500).json({ error: "Failed to fetch items" });
      }
    },
  );

  // Get favourite scanned items (must be before /:id to avoid route conflict)
  app.get(
    "/api/scanned-items/favourites",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const limit = Math.min(
          Math.max(parseInt(req.query.limit as string) || 50, 1),
          100,
        );
        const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

        const result = await storage.getFavouriteScannedItems(
          req.userId!,
          limit,
          offset,
        );
        res.json(result);
      } catch (error) {
        console.error("Error fetching favourite items:", error);
        res.status(500).json({
          error: "Failed to fetch favourites",
          code: "FETCH_FAVOURITES_FAILED",
        });
      }
    },
  );

  app.get(
    "/api/scanned-items/:id",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const id = parsePositiveIntParam(req.params.id as string);
        if (!id) {
          return res.status(400).json({ error: "Invalid item ID" });
        }

        const item = await storage.getScannedItemWithFavourite(id, req.userId!);

        if (!item || item.userId !== req.userId) {
          return res.status(404).json({ error: "Item not found" });
        }

        res.json(item);
      } catch (error) {
        console.error("Error fetching scanned item:", error);
        res.status(500).json({ error: "Failed to fetch item" });
      }
    },
  );

  app.post(
    "/api/scanned-items",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        // Extended schema for scanned items with string coercion for numeric fields
        // Coerce literal "null" strings to actual null
        const nullishString = z
          .string()
          .optional()
          .nullable()
          .transform((v) =>
            v === "null" || v === "undefined" || v === "" ? null : v,
          );

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

        const validated = scannedItemInputSchema.parse({
          ...req.body,
          userId: req.userId!,
        });

        // Transaction: create scanned item + daily log together
        const item = await db.transaction(async (tx) => {
          const [scannedItem] = await tx
            .insert(scannedItems)
            .values({
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
            })
            .returning();

          await tx.insert(dailyLogs).values({
            userId: req.userId!,
            scannedItemId: scannedItem.id,
            servings: "1",
            mealType: null,
          });

          return scannedItem;
        });

        res.status(201).json(item);
      } catch (error) {
        if (error instanceof ZodError) {
          return res.status(400).json({ error: formatZodError(error) });
        }
        console.error("Error creating scanned item:", error);
        res.status(500).json({ error: "Failed to save item" });
      }
    },
  );

  // Toggle favourite on a scanned item
  app.post(
    "/api/scanned-items/:id/favourite",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const id = parsePositiveIntParam(req.params.id as string);
        if (!id) {
          return res
            .status(400)
            .json({ error: "Invalid item ID", code: "INVALID_ITEM_ID" });
        }

        // IDOR: verify ownership (getScannedItem filters discarded items,
        // so favouriting a discarded item returns 404 — intentional)
        const item = await storage.getScannedItem(id);
        if (!item || item.userId !== req.userId) {
          return res
            .status(404)
            .json({ error: "Item not found", code: "ITEM_NOT_FOUND" });
        }

        const isFavourited = await storage.toggleFavouriteScannedItem(
          id,
          req.userId!,
        );
        res.json({ isFavourited });
      } catch (error) {
        console.error("Error toggling favourite:", error);
        res.status(500).json({
          error: "Failed to toggle favourite",
          code: "TOGGLE_FAVOURITE_FAILED",
        });
      }
    },
  );

  // Soft delete (discard) a scanned item
  app.delete(
    "/api/scanned-items/:id",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const id = parsePositiveIntParam(req.params.id as string);
        if (!id) {
          return res
            .status(400)
            .json({ error: "Invalid item ID", code: "INVALID_ITEM_ID" });
        }

        const deleted = await storage.softDeleteScannedItem(id, req.userId!);
        if (!deleted) {
          return res
            .status(404)
            .json({ error: "Item not found", code: "ITEM_NOT_FOUND" });
        }

        res.status(204).send();
      } catch (error) {
        console.error("Error discarding scanned item:", error);
        res.status(500).json({
          error: "Failed to discard item",
          code: "DISCARD_ITEM_FAILED",
        });
      }
    },
  );

  app.get(
    "/api/daily-summary",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const dateParam = req.query.date as string;
        const date = dateParam ? new Date(dateParam) : new Date();

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
        res.status(500).json({ error: "Failed to fetch summary" });
      }
    },
  );
}
