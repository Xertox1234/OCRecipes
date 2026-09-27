import type { Express, Response } from "express";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { crudRateLimit } from "./_rate-limiters";
import { handleRouteError } from "./_helpers";
import { storage } from "../storage";
import { lookupNutrition } from "../services/nutrition-lookup";
import {
  nutrientValues,
  scaleToGrams,
  type NutrientValues,
} from "../services/portion-nutrition";
import { roundToOneDecimal } from "../lib/math";
import {
  BEVERAGE_TYPES,
  BEVERAGE_SIZES,
  BEVERAGE_MODIFIERS,
  ZERO_CAL_BEVERAGES,
  BEVERAGE_DISPLAY,
  BEVERAGE_LOOKUP_NAMES,
  BEVERAGE_MODIFIER_PORTIONS,
  type BeverageType,
  type BeverageSize,
  type BeverageModifier,
} from "@shared/constants/beverages";
import { ErrorCode } from "@shared/constants/error-codes";

const logBeverageSchema = z
  .object({
    beverageType: z.enum(BEVERAGE_TYPES),
    size: z.enum(["small", "medium", "large"] as const),
    modifiers: z.array(z.enum(BEVERAGE_MODIFIERS)).optional().default([]),
    customName: z.string().max(100).optional(),
    customCalories: z.number().min(0).max(5000).optional(),
    mealType: z.string().nullable().optional(),
  })
  .refine(
    (data) =>
      data.beverageType !== "custom" ||
      data.customName !== undefined ||
      data.customCalories !== undefined,
    { message: "Custom beverages require either a name or calorie count" },
  );

/**
 * Nutrition for the whole drink: the drink scaled to its size plus a fixed
 * amount of each modifier. Null when any lookup finds nothing.
 *
 * Lookups answer per 100 g (CNF/USDA) or per serving (API Ninjas); a result
 * whose basis can't be weighed ("1 serving") is kept as it is, with its own
 * serving size, rather than scaled by a guess. Such a drink takes no
 * modifiers (null): grams of cream added to "1 serving" mix two bases.
 * A non-numeric value counts as 0.
 */
async function lookupDrinkNutrition(
  lookupName: string,
  ml: number,
  modifiers: BeverageModifier[],
): Promise<{ values: NutrientTotals; servingSize: string } | null> {
  const drink = await lookupNutrition(lookupName);
  if (!drink) return null;

  const scaled = scaleToGrams(drink, ml); // ml ≈ g for drinks
  if (!scaled && modifiers.length > 0) return null;
  const parts = [scaled ?? nutrientValues(drink)];
  const servingSize = scaled ? `${ml} ml` : drink.servingSize;

  for (const modifier of modifiers) {
    const { lookupName: name, grams } = BEVERAGE_MODIFIER_PORTIONS[modifier];
    const found = await lookupNutrition(name);
    const portion = found && scaleToGrams(found, grams);
    if (!portion) return null;
    parts.push(portion);
  }

  return { values: sumNutrients(parts), servingSize };
}

type NutrientTotals = Record<keyof NutrientValues, number>;

function sumNutrients(parts: NutrientValues[]): NutrientTotals {
  const total = (key: keyof NutrientValues) =>
    roundToOneDecimal(parts.reduce((sum, part) => sum + (part[key] ?? 0), 0));
  return {
    calories: Math.round(total("calories")),
    protein: total("protein"),
    carbs: total("carbs"),
    fat: total("fat"),
    fiber: total("fiber"),
    sugar: total("sugar"),
    sodium: total("sodium"),
  };
}

function buildProductName(
  beverage: BeverageType,
  size: BeverageSize,
  modifiers: BeverageModifier[],
  customName?: string,
): string {
  if (beverage === "custom" && customName) {
    return `${customName}, ${BEVERAGE_SIZES[size].label}`;
  }
  const display = BEVERAGE_DISPLAY[beverage as Exclude<BeverageType, "custom">];
  const label = display?.label ?? beverage;
  const parts = [label];
  if (modifiers.length > 0) {
    parts.push(`with ${modifiers.join(" & ")}`);
  }
  parts.push(`(${BEVERAGE_SIZES[size].label})`);
  return parts.join(" ");
}

export function register(app: Express): void {
  app.post(
    "/api/beverages/log",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const validated = logBeverageSchema.parse(req.body);
        const { beverageType, size, modifiers, customName, customCalories } =
          validated;

        let calories = 0;
        let protein = 0;
        let carbs = 0;
        let fat = 0;
        let fiber = 0;
        let sugar = 0;
        let sodium = 0;
        let servingSize = `${BEVERAGE_SIZES[size].oz} fl oz`;

        // Zero-cal beverages (water) skip lookup
        const isZeroCal = ZERO_CAL_BEVERAGES.includes(beverageType);

        if (isZeroCal) {
          // Water: all zeros, no lookup needed
        } else if (beverageType === "custom" && customCalories !== undefined) {
          // Custom with raw calorie entry — no macros
          calories = customCalories;
        } else {
          // Standard beverage or custom with name — look up the drink by
          // name (no size: lookups answer per 100 g) and scale it to the size.
          const lookupName =
            beverageType === "custom"
              ? (customName ?? "")
              : BEVERAGE_LOOKUP_NAMES[
                  beverageType as keyof typeof BEVERAGE_LOOKUP_NAMES
                ];
          const nutrition = await lookupDrinkNutrition(
            lookupName,
            BEVERAGE_SIZES[size].ml,
            beverageType === "custom" ? [] : modifiers,
          );
          if (!nutrition) {
            return sendError(
              res,
              422,
              "Could not find nutrition data for this beverage. Try entering calories manually.",
              ErrorCode.NUTRITION_LOOKUP_FAILED,
            );
          }
          calories = nutrition.values.calories;
          protein = nutrition.values.protein;
          carbs = nutrition.values.carbs;
          fat = nutrition.values.fat;
          fiber = nutrition.values.fiber;
          sugar = nutrition.values.sugar;
          sodium = nutrition.values.sodium;
          if (nutrition.servingSize) servingSize = nutrition.servingSize;
        }

        const productName = buildProductName(
          beverageType,
          size,
          modifiers,
          customName,
        );

        // Create scanned item + daily log atomically via storage layer
        const scannedItem = await storage.createScannedItemWithLog(
          {
            userId: req.userId,
            productName,
            servingSize,
            calories: calories.toString(),
            protein: protein.toString(),
            carbs: carbs.toString(),
            fat: fat.toString(),
            fiber: fiber.toString(),
            sugar: sugar.toString(),
            sodium: sodium.toString(),
            sourceType: "beverage",
          },
          { source: "beverage", mealType: validated.mealType || null },
        );

        res.status(201).json(scannedItem);
      } catch (error) {
        handleRouteError(res, error, "log beverage");
      }
    },
  );
}
