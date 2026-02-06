import { z } from "zod";

export const photoIntents = ["log", "identify", "recipe", "calories"] as const;
export const photoIntentSchema = z.enum(photoIntents);
export type PhotoIntent = z.infer<typeof photoIntentSchema>;

export const foodCategories = [
  "protein",
  "vegetable",
  "grain",
  "fruit",
  "dairy",
  "beverage",
  "other",
] as const;
export const foodCategorySchema = z.enum(foodCategories);
export type FoodCategory = z.infer<typeof foodCategorySchema>;

/**
 * Preparation options per food category.
 * Every category includes "As Served" as the default.
 */
export const PREPARATION_OPTIONS: Record<FoodCategory, string[]> = {
  protein: [
    "As Served",
    "Raw",
    "Grilled",
    "Pan-Fried",
    "Deep-Fried",
    "Baked",
    "Roasted",
    "Steamed",
    "Boiled",
    "Sautéed",
  ],
  vegetable: [
    "As Served",
    "Raw",
    "Steamed",
    "Sautéed",
    "Roasted",
    "Boiled",
    "Grilled",
    "Stir-Fried",
  ],
  grain: ["As Served", "Steamed", "Boiled", "Fried", "Baked"],
  fruit: ["As Served", "Raw", "Baked", "Grilled"],
  dairy: ["As Served"],
  beverage: ["As Served"],
  other: ["As Served", "Raw", "Cooked"],
};

/**
 * Per-intent configuration describing what each intent requires.
 */
export const INTENT_CONFIG: Record<
  PhotoIntent,
  {
    needsNutrition: boolean;
    needsSession: boolean;
    canLog: boolean;
    label: string;
  }
> = {
  log: {
    needsNutrition: true,
    needsSession: true,
    canLog: true,
    label: "Log this meal",
  },
  identify: {
    needsNutrition: false,
    needsSession: false,
    canLog: false,
    label: "Just identify",
  },
  recipe: {
    needsNutrition: false,
    needsSession: false,
    canLog: false,
    label: "Find recipes",
  },
  calories: {
    needsNutrition: true,
    needsSession: false,
    canLog: false,
    label: "Quick calorie check",
  },
};

/** Schema for preparation methods stored in scannedItems JSONB */
export const preparationMethodSchema = z.object({
  name: z.string(),
  method: z.string(),
});
export type PreparationMethod = z.infer<typeof preparationMethodSchema>;
