import type { Express, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { isUniqueViolation } from "../lib/db-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { insertScannedItemSchema } from "@shared/schema";
import { logger, toError } from "../lib/logger";
import { lookupNutrition } from "../services/nutrition-lookup";
import { lookupBarcode } from "../services/barcode-lookup";
import {
  buildScanResponseFlags,
  type ProfileOutcome,
} from "../services/scan-flags";
import { evaluateUniversalFlags } from "../services/universal-flags";
import { parseUserAllergies } from "@shared/constants/allergens";
import { nutritionLookupRateLimit, pantryRateLimit } from "./_rate-limiters";
import { numericStringField } from "./_schemas";
import {
  handleRouteError,
  parsePositiveIntParam,
  parseQueryInt,
  parseQueryDate,
  parseQueryString,
  parseTimezone,
} from "./_helpers";

// Coerce literal "null" strings to actual null
const nullishString = z
  .string()
  .optional()
  .nullable()
  .transform((v) => (v === "null" || v === "undefined" || v === "" ? null : v));

// Extended schema for scanned items with string coercion for numeric fields
const scannedItemInputSchema = insertScannedItemSchema.extend({
  barcode: z
    .string()
    .regex(/^\d+$/, "Barcode must contain only digits")
    .max(50, "Barcode must not exceed 50 characters")
    .optional()
    .nullable(),
  productName: z
    .string()
    .min(1, "Product name is required")
    .max(200, "Product name must not exceed 200 characters")
    .default("Unknown Product"),
  brandName: nullishString,
  servingSize: nullishString,
  calories: numericStringField,
  protein: numericStringField,
  carbs: numericStringField,
  fat: numericStringField,
  fiber: numericStringField,
  sugar: numericStringField,
  sodium: numericStringField,
});

export function register(app: Express): void {
  // Nutrition lookup by product name — used as fallback when OpenFoodFacts
  // returns only per-100g data without serving size information.
  app.get(
    "/api/nutrition/lookup",
    requireAuth,
    nutritionLookupRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
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
        handleRouteError(res, error, "look up nutrition");
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
    async (req: AuthenticatedRequest, res: Response) => {
      const rawCode = req.params.code;
      const code = typeof rawCode === "string" ? rawCode.trim() : "";
      if (!code || code.length > 50 || !/^\d+$/.test(code)) {
        sendError(res, 400, "Invalid barcode", ErrorCode.VALIDATION_ERROR);
        return;
      }

      try {
        const [result, verification, profileOutcome] = await Promise.all([
          lookupBarcode(code),
          storage.getVerification(code),
          // Fail-dangerous, NOT fatal: a profile-read hiccup must never break
          // scanning. On rejection we degrade to a "couldn't check" flag — never
          // silence, never a 500 (Global Constraint: allergen flags fail-dangerous).
          storage.getUserProfile(req.userId).then(
            (profile): ProfileOutcome => ({
              ok: true,
              allergies: parseUserAllergies(profile?.allergies),
            }),
            (err): ProfileOutcome => {
              logger.warn(
                { err: toError(err) },
                "scan-flags: profile read failed",
              );
              return { ok: false };
            },
          ),
        ]);
        if (!result) {
          sendError(res, 404, "Product not found", ErrorCode.NOT_FOUND);
          return;
        }

        const flags = buildScanResponseFlags(
          {
            allergenTags: result.allergenTags ?? [],
            ingredientsText: result.ingredientsText ?? null,
            allergenDataAvailable: result.allergenDataAvailable,
          },
          profileOutcome,
        );

        // Universal nutrition flags (Phase 2): NOVA/Nutri-Score/caffeine/
        // sweetener/FSA-threshold evaluation. `perServing` is only passed
        // when `isServingDataTrusted` is true — an untrusted (estimated)
        // serving must not feed the caffeine-High-mg or FSA per-portion
        // escalation checks, both of which key specifically on real
        // per-serving data. `result.perServing` itself is always a populated
        // object (never undefined) — `BarcodeLookupResult.perServing` is a
        // required field, scaled from per100g even when untrusted — so no
        // optional-chaining is needed on the individual nutrient reads below.
        const universalFlags = evaluateUniversalFlags({
          per100g: {
            sugar: result.per100g.sugar,
            saturatedFat: result.per100g.saturatedFat,
            sodium: result.per100g.sodium,
            caffeine: result.per100g.caffeine,
          },
          perServing: result.isServingDataTrusted
            ? {
                sugar: result.perServing.sugar,
                saturatedFat: result.perServing.saturatedFat,
                sodium: result.perServing.sodium,
                caffeine: result.perServing.caffeine,
              }
            : undefined,
          servingGrams: result.servingInfo.grams,
          categoriesTags: result.categoriesTags ?? [],
          novaGroup: result.novaGroup,
          nutriScore: result.nutriScore,
          additivesTags: result.additivesTags ?? [],
          ingredientsText: result.ingredientsText ?? null,
        });
        // Allergen (Phase 1, safety tier) flags first, then universal
        // (Phase 2, nutrition tier) flags.
        const orderedFlags = [...flags, ...universalFlags];

        // Raw OFF allergen/ingredient/additive/category fields are consumed
        // here to build `flags`/`universalFlags` — no client reads them
        // directly, and additivesTags/categoriesTags are OFF-licensed
        // (ODbL) content that must never reach the client or be persisted —
        // so trim them all off the response body before spreading
        // (`orderedFlags` already carries the computed result; `novaGroup`
        // and `nutriScore` are kept — they are displayed).
        const {
          ingredientsText: _ingredientsText,
          allergenTags: _allergenTags,
          allergenDataAvailable: _allergenDataAvailable,
          additivesTags: _additivesTags,
          categoriesTags: _categoriesTags,
          ...clientResult
        } = result;
        void _ingredientsText;
        void _allergenTags;
        void _allergenDataAvailable;
        void _additivesTags;
        void _categoriesTags;

        res.json({
          ...clientResult,
          flags: orderedFlags,
          verificationLevel: verification?.verificationLevel ?? "unverified",
          verificationCount: verification?.verificationCount ?? 0,
        });
      } catch (error) {
        handleRouteError(res, error, "look up barcode");
      }
    },
  );

  // Frequently logged items for Quick Log suggestions
  app.get(
    "/api/scanned-items/frequent",
    requireAuth,
    pantryRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const limit = parseQueryInt(req.query.limit, {
          default: 5,
          min: 1,
          max: 20,
        });

        const items = await storage.getFrequentItems(req.userId, limit);
        res.json({ items });
      } catch (error) {
        handleRouteError(res, error, "fetch frequent items");
      }
    },
  );

  app.get(
    "/api/scanned-items",
    requireAuth,
    pantryRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const limit = parseQueryInt(req.query.limit, {
          default: 50,
          min: 1,
          max: 100,
        });
        const offset = parseQueryInt(req.query.offset, { default: 0, min: 0 });

        const result = await storage.getScannedItems(req.userId, limit, offset);
        res.json(result);
      } catch (error) {
        handleRouteError(res, error, "fetch items");
      }
    },
  );

  app.get(
    "/api/scanned-items/:id",
    requireAuth,
    pantryRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
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

        const item = await storage.getScannedItemWithFavourite(id, req.userId);

        if (!item || item.userId !== req.userId) {
          return sendError(res, 404, "Item not found", ErrorCode.NOT_FOUND);
        }

        res.json(item);
      } catch (error) {
        handleRouteError(res, error, "fetch item");
      }
    },
  );

  app.post(
    "/api/scanned-items",
    requireAuth,
    pantryRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const rawIdempotencyKey = req.headers["x-idempotency-key"];
        // Bound the client-supplied key: accept only a sane-length string (the
        // client always sends a crypto.randomUUID()). Ignore an over-long or
        // non-string value rather than persisting arbitrary text or failing the
        // save (L1). The previous `as string` also wrongly assumed never-an-array.
        const idempotencyKey =
          typeof rawIdempotencyKey === "string" &&
          rawIdempotencyKey.length > 0 &&
          rawIdempotencyKey.length <= 200
            ? rawIdempotencyKey
            : undefined;

        // Idempotency check: if key present and we've seen it, return existing item
        if (idempotencyKey) {
          const existing = await storage.getScannedItemByIdempotencyKey(
            req.userId!,
            idempotencyKey,
          );
          if (existing) {
            return res.status(200).json(existing);
          }
        }

        const validated = scannedItemInputSchema.parse({
          ...req.body,
          userId: req.userId,
        });

        // No logOverrides needed — defaults to source: "scan", mealType: null
        try {
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
            idempotencyKey: idempotencyKey ?? null,
          });
          return res.status(201).json(item);
        } catch (error) {
          // Concurrent double-submit with the same idempotency key: both requests
          // pass the existence check above, then the losing insert hits the
          // (userId, idempotencyKey) unique index (23505). The intent was
          // idempotency, so return the row the winning request created (200)
          // instead of a 500 (M3) — the same isUniqueViolation guard register() uses.
          if (idempotencyKey && isUniqueViolation(error)) {
            const existing = await storage.getScannedItemByIdempotencyKey(
              req.userId!,
              idempotencyKey,
            );
            if (existing) return res.status(200).json(existing);
          }
          // Not a unique violation, or the re-fetch missed (winning row deleted
          // mid-race) → fall through to the outer handler (500, or the typed
          // status handleRouteError maps a ZodError to).
          throw error;
        }
      } catch (error) {
        handleRouteError(res, error, "save item");
      }
    },
  );

  // Toggle favourite on a scanned item
  app.post(
    "/api/scanned-items/:id/favourite",
    requireAuth,
    pantryRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
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

        // Ownership + discardedAt check is done inside the transaction
        // to close the TOCTOU gap (see storage.toggleFavouriteScannedItem).
        const isFavourited = await storage.toggleFavouriteScannedItem(
          id,
          req.userId,
        );

        if (isFavourited === null) {
          return sendError(res, 404, "Item not found", ErrorCode.NOT_FOUND);
        }

        res.json({ isFavourited });
      } catch (error) {
        logger.error({ err: toError(error) }, "toggle favourite failed");
        sendError(
          res,
          500,
          "Failed to toggle favourite",
          ErrorCode.TOGGLE_FAILED,
        );
      }
    },
  );

  // Soft delete (discard) a scanned item
  app.delete(
    "/api/scanned-items/:id",
    requireAuth,
    pantryRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
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

        const deleted = await storage.softDeleteScannedItem(id, req.userId);
        if (!deleted) {
          return sendError(res, 404, "Item not found", ErrorCode.NOT_FOUND);
        }

        res.status(204).send();
      } catch (error) {
        handleRouteError(res, error, "discard item");
      }
    },
  );

  app.get(
    "/api/daily-summary",
    requireAuth,
    pantryRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const date = parseQueryDate(req.query.date) ?? new Date();
        const tz = parseTimezone(req.headers["x-timezone"]);

        const [summary, confirmedIds] = await Promise.all([
          storage.getDailySummary(req.userId, date, tz),
          storage.getConfirmedMealPlanItemIds(req.userId, date),
        ]);
        const planned = await storage.getPlannedNutritionSummary(
          req.userId,
          date,
          confirmedIds,
        );
        res.json({
          ...summary,
          ...planned,
          confirmedMealPlanItemIds: confirmedIds,
        });
      } catch (error) {
        handleRouteError(res, error, "fetch summary");
      }
    },
  );
}
