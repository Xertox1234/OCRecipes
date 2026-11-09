import { z } from "zod";
import {
  writeCardDaySchema,
  writeCardMealTypeSchema,
} from "@shared/schemas/coach-write-cards";

/**
 * Write-tool argument schemas (spec 2026-11-09). DB-FREE on purpose:
 * coach-tools.ts validates with these, and importing the card modules there
 * would pull storage and server/db.ts into every coach-tools importer.
 */

const estimateSchema = z.object({
  calories: z.number().finite().min(0).max(5000),
  protein: z.number().finite().min(0).max(500),
  carbs: z.number().finite().min(0).max(1000),
  fat: z.number().finite().min(0).max(500),
});

export const logFoodCardArgsSchema = z.object({
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        count: z.number().int().min(1).max(20),
        unitLabel: z.string().trim().min(1).max(60),
        estimate: estimateSchema,
      }),
    )
    .min(1)
    .max(8),
  mealType: writeCardMealTypeSchema.optional(),
  day: writeCardDaySchema.optional(),
});
export type LogFoodCardArgs = z.infer<typeof logFoodCardArgsSchema>;

export const addGroceryCardArgsSchema = z.object({
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        quantity: z.string().trim().max(40).optional(),
        unit: z.string().trim().max(40).optional(),
        maybeHave: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(40),
  listName: z.string().trim().min(1).max(100).optional(),
});
export type AddGroceryCardArgs = z.infer<typeof addGroceryCardArgsSchema>;

export const recipeRefArgSchema = z.object({
  source: z.enum(["community", "mine"]),
  id: z.number().int().positive(),
});

export const addMealPlanCardArgsSchema = z.object({
  rows: z
    .array(
      z.object({
        plannedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        mealType: writeCardMealTypeSchema,
        recipe: recipeRefArgSchema,
        alternatives: z.array(recipeRefArgSchema).max(3).default([]),
      }),
    )
    .min(1)
    .max(7),
});
export type AddMealPlanCardArgs = z.infer<typeof addMealPlanCardArgsSchema>;

export type RecipeRefArg = z.infer<typeof recipeRefArgSchema>;

/** A write tool call in write-card mode, args already validated. */
export type WriteCardProposal =
  | { kind: "food"; args: LogFoodCardArgs }
  | { kind: "grocery"; args: AddGroceryCardArgs }
  | { kind: "plan"; args: AddMealPlanCardArgs };
