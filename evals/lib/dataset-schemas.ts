import { z } from "zod";

// ─── Recipe Chat ──────────────────────────────────────────────────────────────

export const recipeChatInputSchema = z.object({
  userMessage: z.string().min(1),
  userProfile: z
    .object({
      dietType: z.string().nullable(),
      allergies: z.array(z.string()),
      dislikes: z.array(z.string()),
    })
    .nullable(),
  conversationHistory: z
    .array(
      z.object({
        role: z.enum(["user", "assistant", "system"]),
        content: z.string(),
      }),
    )
    .default([]),
});

export const recipeChatCaseSchema = z.object({
  id: z.string().min(1),
  category: z.enum([
    "safety",
    "accuracy",
    "helpfulness",
    "personalization",
    "edge-case",
    "creativity",
  ]),
  description: z.string(),
  input: recipeChatInputSchema,
  assertions: z
    .object({
      mustNotContain: z.array(z.string()).optional(),
      mustContain: z.array(z.string()).optional(),
    })
    .optional(),
  scoreDimensions: z
    .array(
      z.enum([
        "relevance",
        "recipe_quality",
        "dietary_compliance",
        "safety",
        "tone",
      ]),
    )
    .optional(),
});

export const recipeChatCasesSchema = z.array(recipeChatCaseSchema);
export type RecipeChatInput = z.infer<typeof recipeChatInputSchema>;

// ─── Meal Suggestions ─────────────────────────────────────────────────────────

const macroSchema = z.object({
  calories: z.number(),
  protein: z.number(),
  carbs: z.number(),
  fat: z.number(),
});

export const mealSuggestionCaseSchema = z.object({
  id: z.string().min(1),
  category: z.enum([
    "safety",
    "accuracy",
    "helpfulness",
    "personalization",
    "edge-case",
    "creativity",
  ]),
  description: z.string(),
  input: z.object({
    mealType: z.string(),
    userProfile: z
      .object({
        dietType: z.string().nullable(),
        allergies: z.array(z.string()),
        dislikes: z.array(z.string()),
      })
      .nullable(),
    dailyTargets: macroSchema,
    existingMeals: z.array(
      z.object({
        title: z.string(),
        calories: z.number(),
        mealType: z.string(),
      }),
    ),
    remainingBudget: macroSchema,
  }),
  assertions: z
    .object({
      mustNotContain: z.array(z.string()).optional(),
      mustContain: z.array(z.string()).optional(),
      macrosBudgetRespected: z.boolean().optional(),
      suggestionCount: z.number().optional(),
    })
    .optional(),
  scoreDimensions: z
    .array(
      z.enum([
        "macro_accuracy",
        "dietary_compliance",
        "variety",
        "helpfulness",
      ]),
    )
    .optional(),
});

export const mealSuggestionCasesSchema = z.array(mealSuggestionCaseSchema);
export type MealSuggestionCaseInput = z.infer<
  typeof mealSuggestionCaseSchema
>["input"];

// ─── Recipe Generation ────────────────────────────────────────────────────────

export const recipeGenCaseSchema = z.object({
  id: z.string().min(1),
  category: z.enum([
    "safety",
    "accuracy",
    "helpfulness",
    "personalization",
    "creativity",
    "edge-case",
  ]),
  description: z.string(),
  input: z.object({
    productName: z.string().min(1),
    servings: z.number().optional(),
    timeConstraint: z.string().optional(),
    dietPreferences: z.array(z.string()).optional(),
    userProfile: z
      .object({
        dietType: z.string().nullable(),
        allergies: z.array(z.string()),
        dislikes: z.array(z.string()),
      })
      .nullable(),
  }),
  assertions: z
    .object({
      mustNotContain: z.array(z.string()).optional(),
      mustContain: z.array(z.string()).optional(),
      mustHaveMinIngredients: z.number().optional(),
      mustHaveMinInstructions: z.number().optional(),
    })
    .optional(),
  scoreDimensions: z
    .array(
      z.enum([
        "ingredient_coherence",
        "instruction_clarity",
        "dietary_compliance",
        "creativity",
      ]),
    )
    .optional(),
});

export const recipeGenCasesSchema = z.array(recipeGenCaseSchema);
export type RecipeGenInput = z.infer<typeof recipeGenCaseSchema>["input"];
