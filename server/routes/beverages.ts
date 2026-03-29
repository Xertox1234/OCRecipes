import type { Express, Response } from "express";
import { z, ZodError } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { formatZodError } from "./_helpers";
import { storage } from "../storage";
import { lookupNutrition } from "../services/nutrition-lookup";
import {
  BEVERAGE_TYPES,
  BEVERAGE_SIZES,
  BEVERAGE_MODIFIERS,
  ZERO_CAL_BEVERAGES,
  BEVERAGE_DISPLAY,
  type BeverageType,
  type BeverageSize,
  type BeverageModifier,
} from "@shared/constants/beverages";

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

function buildNutritionQuery(
  beverage: BeverageType,
  size: BeverageSize,
  modifiers: BeverageModifier[],
): string {
  const oz = BEVERAGE_SIZES[size].oz;
  const base = `${oz}oz ${beverage}`;
  if (modifiers.length === 0) return base;
  return `${base} with ${modifiers.join(" and ")}`;
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
          // Standard beverage or custom with name — run nutrition lookup
          const query =
            beverageType === "custom" && customName
              ? `${BEVERAGE_SIZES[size].oz}oz ${customName}`
              : buildNutritionQuery(beverageType, size, modifiers);

          const nutrition = await lookupNutrition(query);
          if (!nutrition) {
            return sendError(
              res,
              422,
              "Could not find nutrition data for this beverage. Try entering calories manually.",
              "NUTRITION_LOOKUP_FAILED",
            );
          }
          calories = nutrition.calories;
          protein = nutrition.protein;
          carbs = nutrition.carbs;
          fat = nutrition.fat;
          fiber = nutrition.fiber;
          sugar = nutrition.sugar;
          sodium = nutrition.sodium;
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
        if (error instanceof ZodError) {
          return sendError(res, 400, formatZodError(error));
        }
        console.error("Beverage logging failed:", error);
        sendError(res, 500, "Internal server error", ErrorCode.INTERNAL_ERROR);
      }
    },
  );
}
