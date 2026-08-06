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
import {
  lookupBarcode,
  type BarcodeLookupResult,
} from "../services/barcode-lookup";
import {
  buildScanResponseFlags,
  type ProfileOutcome,
} from "../services/scan-flags";
import { evaluateUniversalFlags } from "../services/universal-flags";
import { buildLabelConflict } from "../services/label-override";
import { createNutrientUnavailableFlag } from "@shared/types/scan-flags";
import { parseUserAllergies } from "@shared/constants/allergens";
import { isBeverageCategory } from "@shared/constants/nutrition-bands";
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

// Builds the client response body for one BarcodeLookupResult: allergen +
// universal flags, ODbL strip, verification fields. Used by GET and POST so
// the flag-build + strip logic never drifts between the two branches.
function buildBarcodeResponseBody(
  result: BarcodeLookupResult,
  profileOutcome: ProfileOutcome,
  verification: Awaited<ReturnType<typeof storage.getVerification>>,
) {
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

  // Derived BEFORE the ODbL trim below, because categoriesTags is what it
  // reads — and a derived boolean is our own classification, not OFF
  // content, so it may ship where the tags themselves may not. The client
  // needs it to pick the FSA per-100g vs per-100ml scale, which differs by
  // ~2x.
  //
  // An EMPTY categoriesTags array (the real shape for a USDA-only match or
  // any OFF product missing categories_tags — see
  // extractOffUniversalData's null branch in barcode-lookup.ts) means "no
  // category signal", not "confirmed not a beverage". isBeverageCategory([])
  // returns false by design, so calling it unconditionally would emit a
  // false claim of certainty here. That false would override Task 6's
  // serving-unit fallback (resolveBasis short-circuits on a boolean before
  // it ever inspects the parsed serving unit), silently halving the FSA
  // sugar/fat/etc. thresholds for a real drink that just lacks OFF
  // category data. So: only classify when there is at least one tag to
  // classify from. Leaving `isBeverage` `undefined` here drops the key
  // entirely (`res.json` omits `undefined` properties), which is exactly
  // the "absent → fall back to the parsed serving unit, never default to
  // food" behaviour the spec's error-handling table defines. DO NOT
  // "simplify" this back to `isBeverageCategory(result.categoriesTags ??
  // [])` — that reintroduces the false-food bug.
  const isBeverage =
    result.categoriesTags && result.categoriesTags.length > 0
      ? isBeverageCategory(result.categoriesTags)
      : undefined;

  // Raw OFF allergen/ingredient/additive/category fields are consumed
  // here to build `flags`/`universalFlags` — no client reads them
  // directly, and additivesTags/categoriesTags are OFF-licensed
  // (ODbL) content that must never reach the client or be persisted —
  // so trim them all off the response body before spreading
  // (`orderedFlags` already carries the computed result).
  //
  // `novaGroup`/`nutriScore` are deliberately NOT trimmed, but they are not
  // "displayed" either — an earlier version of this comment said so and was
  // wrong. They are consumed above as `evaluateUniversalFlags` input and
  // reach the user only as the computed `processing:ultra` and
  // `nutriscore:<grade>` flags; NutritionDetailScreen's `partition.nutriScore`
  // is a `ScanFlag` derived from `orderedFlags`, not this scalar. No current
  // client reads either raw value. They stay on the wire for compatibility
  // with already-shipped bundles that predate the removal of the client-side
  // `NutritionData.novaGroup`/`nutriScore` fields, which SHIPPED 2026-07-24
  // (#708, `13bf5059`) — not 2026-07-22, which is when #694 ADDED them, and
  // also the filing date of the todo that removed them. Measure the window
  // from the ship date. OTA updates apply on second cold start, so old
  // readers can still be live. Safe to drop from the response body once
  // those bundles are out of circulation.
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

  return {
    ...clientResult,
    flags: orderedFlags,
    isBeverage,
    verificationLevel: verification?.verificationLevel ?? "unverified",
    verificationCount: verification?.verificationCount ?? 0,
  };
}

const labelNutritionSchema = z.object({
  labelNutrition: z.object({
    // Defense-in-depth: nutrition values are never negative; cap at a sane
    // upper bound too (100000 covers any plausible per-serving reading).
    calories: z.number().finite().nonnegative().max(100000).nullable(),
    totalSugars: z.number().finite().nonnegative().max(100000).nullable(),
    totalFat: z.number().finite().nonnegative().max(100000).nullable(),
    saturatedFat: z.number().finite().nonnegative().max(100000).nullable(),
    servingSize: z.string().max(120).nullable(),
    // OCR provenance: the parser fields read DIRECTLY off a glyph run, as
    // opposed to reconstructed by its `gluedUnitIsForced` containment rule.
    // `buildLabelConflict` will not COMPARE an inferred `saturatedFat` against
    // the record — see the `requiresDirectRead` policy there.
    //
    // OPTIONAL, and that is load-bearing. Clients already installed (and every
    // client on an older OTA bundle) send no such key, and an absent key must
    // fall to "not a direct read" rather than defaulting to "direct" — a
    // default in the other direction would leave every existing install on the
    // exact behaviour this validates against. Making it REQUIRED would be worse
    // still: those clients would 400 and lose the label entirely.
    //
    // Typed as loose strings rather than a `z.enum` of the four known fields on
    // purpose. `z.enum` would reject the whole request the first time a future
    // client adds a fifth provenance key against an older server, dropping the
    // label; an unrecognised entry here is simply inert, since the only
    // question ever asked of this list is whether it CONTAINS a given field.
    directReads: z.array(z.string().max(40)).max(32).optional(),
  }),
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

        const body = buildBarcodeResponseBody(
          result,
          profileOutcome,
          verification,
        );
        res.json(body);
      } catch (error) {
        handleRouteError(res, error, "look up barcode");
      }
    },
  );

  // Trust-the-label override: POST because the client sends OCR'd label
  // nutrition for in-memory comparison against the DB result (never
  // persisted). Reuses the same auth + rate limiter as the GET above. On a
  // material conflict, returns today's GET body plus a `conflict` object
  // whose `label` is a fully client-shaped result (own recomputed flags) so
  // the client can toggle between DB and label values without a second call.
  app.post(
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

      const parsed = labelNutritionSchema.safeParse(req.body);
      if (!parsed.success) {
        sendError(res, 400, "Invalid label data", ErrorCode.VALIDATION_ERROR);
        return;
      }

      try {
        const [result, verification, profileOutcome] = await Promise.all([
          lookupBarcode(code),
          storage.getVerification(code),
          // Fail-dangerous, NOT fatal — same rationale as the GET handler.
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

        const body = buildBarcodeResponseBody(
          result,
          profileOutcome,
          verification,
        );
        const { conflict, fields, labelResult, compared } = buildLabelConflict(
          result,
          parsed.data.labelNutrition,
        );
        // `labelCompared` is additive and POST-only (the GET handler never
        // receives a label). It exists because a 200 without `conflict` is
        // ambiguous — buildLabelConflict returns that same shape when it DECLINES
        // to compare (unparseable serving, implausible serving, no comparable
        // field). The client gates one-tap logging on this, so it must be sent on
        // BOTH paths: omitting it on the conflict path would gate a label that
        // was in fact used.
        if (conflict && labelResult) {
          const labelBody = buildBarcodeResponseBody(
            labelResult,
            profileOutcome,
            verification,
          );
          // The label-corrected block deliberately drops macros whose per-100
          // basis the calorie disagreement just proved wrong, so the universal
          // flag recompute emits nothing for them. Say that out loud: otherwise
          // a missing "High in sugar" is indistinguishable from a low-sugar
          // product, on the very screen that tells the user to trust the label.
          //
          // Decided by DIFFING the two bodies, not by asking whether a value
          // was dropped. Most records carry a sodium figure and the label input
          // has no sodium field at all, so a value-presence test fires on
          // essentially every scan — including records whose sodium is 0 or
          // nowhere near the threshold, where no warning ever existed. Only a
          // flag the record actually raised and the label body lost is a
          // warning the user has genuinely stopped seeing.
          const lostNutrientFlags = body.flags.filter(
            (f) =>
              f.kind === "nutrient" &&
              !labelBody.flags.some(
                (lf) => lf.kind === "nutrient" && lf.nutrient === f.nutrient,
              ),
          );
          const labelFlags =
            lostNutrientFlags.length > 0
              ? [
                  ...labelBody.flags,
                  createNutrientUnavailableFlag(
                    `Our record flagged ${lostNutrientFlags
                      .map((f) => f.title.toLowerCase())
                      .join(
                        " and ",
                      )}, but its values didn't match the label, so they aren't shown for this scan.`,
                  ),
                ]
              : labelBody.flags;
          res.json({
            ...body,
            labelCompared: compared,
            conflict: { fields, label: { ...labelBody, flags: labelFlags } },
          });
          return;
        }
        res.json({ ...body, labelCompared: compared });
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
