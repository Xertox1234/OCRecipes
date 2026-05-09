import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { z } from "zod";
import {
  generateMealSuggestions,
  type MealSuggestionInput,
} from "../server/services/meal-suggestions";
import type { UserProfile } from "@shared/schema";
import { runEvalSuite } from "./lib/runner-core";
import type { EvalTestCase } from "./types";

// ─── Dataset schema ───────────────────────────────────────────────────────────

const mealSuggestionCaseSchema = z.object({
  id: z.string().min(1),
  category: z.enum([
    "safety",
    "accuracy",
    "helpfulness",
    "personalization",
    "edge-case",
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
    dailyTargets: z.object({
      calories: z.number(),
      protein: z.number(),
      carbs: z.number(),
      fat: z.number(),
    }),
    existingMeals: z.array(
      z.object({
        title: z.string(),
        calories: z.number(),
        mealType: z.string(),
      }),
    ),
    remainingBudget: z.object({
      calories: z.number(),
      protein: z.number(),
      carbs: z.number(),
      fat: z.number(),
    }),
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

const mealSuggestionCasesSchema = z.array(mealSuggestionCaseSchema);
type MealSuggestionCaseInput = z.infer<
  typeof mealSuggestionCaseSchema
>["input"];

// ─── Rubric ───────────────────────────────────────────────────────────────────

const RUBRIC_TEXT = `You are an expert evaluator of AI meal suggestion responses.

Score the response on each requested dimension using a 1-10 scale with these anchors:

MACRO_ACCURACY (Suggested macros fit within the user's remaining budget):
  1 = Suggestions far exceed remaining calorie/macro budget
  5 = Within budget but imprecise estimates
  10 = Each suggestion fits snugly within remaining macros with accurate breakdowns

DIETARY_COMPLIANCE (Respects all dietary constraints across all 3 suggestions):
  1 = Contains allergen or excluded food in one or more suggestions
  5 = Mostly compliant, minor slip
  10 = All 3 suggestions fully respect allergies, diet type, and dislikes

VARIETY (Suggestions are meaningfully different from each other):
  1 = All 3 suggestions are essentially the same meal
  5 = Some variation in protein source or style
  10 = Meaningfully different cuisines, protein sources, and preparation styles

HELPFULNESS (Suggestions are practical and actionable for the meal type):
  1 = Suggestions are impractical, generic, or wrong for the meal type
  5 = Reasonable options but generic
  10 = Specific, practical, and clearly right for the meal type and time of day`;

// ─── Serialise suggestions for judge + text assertions ────────────────────────

function serialiseSuggestions(
  suggestions: Awaited<ReturnType<typeof generateMealSuggestions>>,
): string {
  return suggestions
    .map(
      (s, i) =>
        `Suggestion ${i + 1}: ${s.title}\n` +
        `  Macros: ${s.calories} cal, ${s.protein}g protein, ${s.carbs}g carbs, ${s.fat}g fat\n` +
        `  Difficulty: ${s.difficulty} | Prep: ${s.prepTimeMinutes} min\n` +
        `  Ingredients: ${s.ingredients.map((ing) => ing.name).join(", ")}\n` +
        `  Reasoning: ${s.reasoning}`,
    )
    .join("\n\n");
}

// ─── Load dataset and run ─────────────────────────────────────────────────────

const datasetPath = path.join(
  __dirname,
  "datasets",
  "meal-suggestion-cases.json",
);
const rawJson = fs.readFileSync(datasetPath, "utf8");
let parsedJson: unknown;
try {
  parsedJson = JSON.parse(rawJson);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(
    `Error: meal-suggestion-cases.json is not valid JSON: ${message}`,
  );
  process.exit(1);
}

const validation = mealSuggestionCasesSchema.safeParse(parsedJson);
if (!validation.success) {
  console.error("Error: meal-suggestion-cases.json failed schema validation:");
  for (const issue of validation.error.errors) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

runEvalSuite(validation.data as unknown as EvalTestCase[], {
  suiteName: "meal-suggestions",
  rubricText: RUBRIC_TEXT,
  dimensions: [
    "macro_accuracy",
    "dietary_compliance",
    "variety",
    "helpfulness",
  ],
  dimensionWeights: {
    macro_accuracy: 2,
    dietary_compliance: 2,
    variety: 1,
    helpfulness: 1,
  },
  inputTag: "meal_request",
  outputTag: "suggestions",

  generateResponse: async (testCase: EvalTestCase) => {
    const i = testCase.input as MealSuggestionCaseInput;
    const serviceInput: MealSuggestionInput = {
      userId: "eval-user",
      date: new Date().toISOString().slice(0, 10),
      mealType: i.mealType,
      userProfile: i.userProfile as UserProfile | null,
      dailyTargets: i.dailyTargets,
      existingMeals: i.existingMeals,
      remainingBudget: i.remainingBudget,
    };

    const start = Date.now();
    const suggestions = await generateMealSuggestions(serviceInput);
    const latencyMs = Date.now() - start;

    const text = serialiseSuggestions(suggestions);
    const wordCount = text.split(/\s+/).filter(Boolean).length;

    const structuredData = {
      suggestions: suggestions.map((s) => ({ calories: s.calories })),
      remainingCalories: i.remainingBudget.calories,
    };

    return { text, structuredData, latencyMs, wordCount };
  },

  formatInput: (testCase: EvalTestCase) => {
    const i = testCase.input as MealSuggestionCaseInput;
    const lines: string[] = [
      `Meal type: ${i.mealType}`,
      `Daily targets: ${i.dailyTargets.calories} cal, ${i.dailyTargets.protein}g protein, ${i.dailyTargets.carbs}g carbs, ${i.dailyTargets.fat}g fat`,
      `Remaining budget: ${i.remainingBudget.calories} cal, ${i.remainingBudget.protein}g protein, ${i.remainingBudget.carbs}g carbs, ${i.remainingBudget.fat}g fat`,
    ];
    if (i.existingMeals.length > 0) {
      lines.push(
        `Already eaten: ${i.existingMeals.map((m) => `${m.title} (${m.calories} cal)`).join(", ")}`,
      );
    }
    if (i.userProfile) {
      if (i.userProfile.dietType) lines.push(`Diet: ${i.userProfile.dietType}`);
      if (i.userProfile.allergies.length > 0) {
        lines.push(`Allergies: ${i.userProfile.allergies.join(", ")}`);
      }
      if (i.userProfile.dislikes.length > 0) {
        lines.push(`Dislikes: ${i.userProfile.dislikes.join(", ")}`);
      }
    }
    return lines.join("\n");
  },
});
