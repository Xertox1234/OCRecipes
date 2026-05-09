import type { Express } from "express";
import { Router } from "express";
import cors from "cors";
import { requireApiKey } from "../middleware/api-key-auth";
import { apiRateLimiter } from "../middleware/api-rate-limit";
import { storage } from "../storage";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { TIER_FEATURES, type ApiTier } from "@shared/constants/api-tiers";
import { barcodeVariants } from "../services/nutrition-lookup";
import type {
  BarcodeVerification,
  BarcodeNutrition,
  CommunityRecipe,
} from "@shared/schema";
import type {
  FreeProductResponse,
  PaidProductResponse,
  CuratedRecipeResponse,
} from "@shared/types/public-api";
import { parseQueryInt, parsePositiveIntParam } from "./_helpers";
import type { FrontLabelData } from "@shared/types/front-label";
import { logger, toError } from "../lib/logger";

const BARCODE_PATTERN = /^\d{8,14}$/;

/** Coerce a nullable decimal string to a number or null */
function toNum(val: string | null | undefined): number | null {
  if (val == null) return null;
  const n = Number(val);
  return Number.isNaN(n) ? null : n;
}

/** Serialize a barcodeNutrition row into the free-tier response shape */
function serializeFreeResponse(row: BarcodeNutrition): FreeProductResponse {
  return {
    barcode: row.barcode,
    productName: row.productName,
    brandName: row.brandName,
    servingSize: row.servingSize,
    calories: toNum(row.calories),
    protein: toNum(row.protein),
    carbs: toNum(row.carbs),
    fat: toNum(row.fat),
    source: row.source,
    verified: false,
  };
}

/** Serialize a barcodeVerification row into the paid-tier response shape.
 *  Strips all PII (scannedByUserId, scannedAt) from frontLabelData. */
function serializePaidResponse(row: BarcodeVerification): PaidProductResponse {
  const consensus = row.consensusNutritionData as {
    calories?: number;
    protein?: number;
    carbs?: number;
    fat?: number;
  } | null;

  const rawFrontLabel = row.frontLabelData as FrontLabelData | null;
  // Strip PII fields — never expose scannedByUserId or scannedAt
  const frontLabel = rawFrontLabel
    ? {
        brand: rawFrontLabel.brand,
        productName: rawFrontLabel.productName,
        netWeight: rawFrontLabel.netWeight,
        claims: rawFrontLabel.claims,
      }
    : null;

  return {
    barcode: row.barcode,
    productName: frontLabel?.productName ?? null,
    brandName: frontLabel?.brand ?? null,
    servingSize: null,
    calories: consensus?.calories ?? null,
    protein: consensus?.protein ?? null,
    carbs: consensus?.carbs ?? null,
    fat: consensus?.fat ?? null,
    source: "verified",
    verified: row.verificationLevel === "verified",
    verificationLevel: row.verificationLevel as
      | "unverified"
      | "single_verified"
      | "verified",
    verificationCount: row.verificationCount,
    lastVerifiedAt: row.updatedAt?.toISOString() ?? null,
    frontLabel,
  };
}

/** Serialize a CommunityRecipe to the public API response shape */
function serializeCuratedRecipe(row: CommunityRecipe): CuratedRecipeResponse {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? null,
    cuisineOrigin: row.cuisineOrigin ?? null,
    difficulty: row.difficulty ?? null,
    timeEstimate: row.timeEstimate ?? null,
    servings: row.servings ?? null,
    dietTags: (row.dietTags as string[]) ?? [],
    mealTypes: (row.mealTypes as string[]) ?? [],
    caloriesPerServing: toNum(row.caloriesPerServing),
    protein: toNum(row.proteinPerServing),
    carbs: toNum(row.carbsPerServing),
    fat: toNum(row.fatPerServing),
    ingredients:
      (row.ingredients as {
        name: string;
        quantity: string;
        unit: string;
      }[]) ?? [],
    instructions: (row.instructions as string[]) ?? [],
    instructionDetails: (row.instructionDetails as (string | null)[]) ?? [],
    toolsRequired:
      (row.toolsRequired as { name: string; affiliateUrl?: string }[]) ?? [],
    chefTips: (row.chefTips as string[]) ?? [],
    canonicalImages: (row.canonicalImages as string[]) ?? [],
    videoUrl: row.videoUrl ?? null,
    canonicalizedAt: row.canonicalizedAt?.toISOString() ?? null,
  };
}

export function register(app: Express): void {
  const router = Router();

  // Permissive CORS for public API only
  router.use(
    cors({
      origin: "*",
      methods: ["GET"],
      allowedHeaders: ["X-API-Key", "Content-Type"],
    }),
  );

  // Beta status header on all responses
  router.use((_req, res, next) => {
    res.setHeader("X-API-Status", "beta");
    next();
  });

  // Auth + rate limiting
  router.use(requireApiKey);
  router.use(apiRateLimiter);

  router.get("/products/:barcode", async (req, res) => {
    try {
      const { barcode } = req.params;

      // Validate barcode format (numeric, 8-14 digits)
      if (!BARCODE_PATTERN.test(barcode)) {
        sendError(
          res,
          400,
          "Invalid barcode format",
          ErrorCode.VALIDATION_ERROR,
        );
        return;
      }

      const tier = req.apiKeyTier as ApiTier;
      const features = TIER_FEATURES[tier];

      // Generate barcode variants for flexible matching
      const variants = barcodeVariants(barcode);

      // Paid tier: try verified data first
      if (features.includesVerified) {
        const verification = await storage.getVerificationByBarcodes(variants);
        if (verification) {
          res.json({ data: serializePaidResponse(verification) });
          return;
        }
      }

      // All tiers: try unverified barcode nutrition
      const nutrition = await storage.getBarcodeNutrition(variants);
      if (nutrition) {
        res.json({ data: serializeFreeResponse(nutrition) });
        return;
      }

      sendError(res, 404, "Product not found", ErrorCode.NOT_FOUND);
    } catch (err) {
      logger.error({ err: toError(err) }, "public API error");
      sendError(res, 500, "Internal server error", ErrorCode.INTERNAL_ERROR);
    }
  });

  // ---------------------------------------------------------------------------
  // Recipe catalogue endpoints
  // ---------------------------------------------------------------------------

  /** GET /api/v1/recipes — paginated list of curated recipes */
  router.get("/recipes", async (req, res) => {
    try {
      const limit = parseQueryInt(req.query.limit, {
        default: 20,
        min: 1,
        max: 50,
      });
      const offset = parseQueryInt(req.query.offset, {
        default: 0,
        min: 0,
      });
      const recipes = await storage.getCuratedRecipes({ limit, offset });
      res.json({ data: recipes.map(serializeCuratedRecipe) });
    } catch (err) {
      logger.error({ err: toError(err) }, "public API recipes list error");
      sendError(res, 500, "Internal server error", ErrorCode.INTERNAL_ERROR);
    }
  });

  /** GET /api/v1/recipes/:id — single curated recipe by ID */
  router.get("/recipes/:id", async (req, res) => {
    try {
      const id = parsePositiveIntParam(req.params.id);
      if (id === null) {
        sendError(res, 400, "Invalid recipe ID", ErrorCode.VALIDATION_ERROR);
        return;
      }
      const recipe = await storage.getCuratedRecipeById(id);
      if (!recipe) {
        sendError(res, 404, "Recipe not found", ErrorCode.NOT_FOUND);
        return;
      }
      res.json({ data: serializeCuratedRecipe(recipe) });
    } catch (err) {
      logger.error({ err: toError(err) }, "public API recipe detail error");
      sendError(res, 500, "Internal server error", ErrorCode.INTERNAL_ERROR);
    }
  });

  // Mount at /api/v1 — separate namespace from internal /api/* routes
  app.use("/api/v1", router);
}
