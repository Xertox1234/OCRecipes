import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import {
  generateRecipeContent,
  type RecipeGenerationInput,
} from "../server/services/recipe-generation";
import type { UserProfile } from "@shared/schema";
import { runEvalSuite } from "./lib/runner-core";
import type { EvalTestCase } from "./types";
import {
  recipeGenCasesSchema,
  type RecipeGenInput,
} from "./lib/dataset-schemas";

// generateRecipeContent does not call image generation (that lives in
// generateFullRecipe), so running it directly already skips image costs.
// EVAL_SKIP_IMAGE_GENERATION is documented for clarity in the npm script.

// ─── Rubric ───────────────────────────────────────────────────────────────────

const RUBRIC_TEXT = `You are an expert evaluator of AI-generated recipes.

Score the response on each requested dimension using a 1-10 scale with these anchors:

INGREDIENT_COHERENCE (Ingredients work together; quantities and units are plausible):
  1 = Ingredients don't belong together or quantities are absurd
  5 = Plausible combination, minor issues with quantities
  10 = All ingredients work together with accurate quantities and units

INSTRUCTION_CLARITY (Steps are clear, correctly ordered, achievable for stated difficulty):
  1 = Steps are out of order, missing, or assume unavailable equipment
  5 = Followable with effort; some ambiguity
  10 = Clear numbered steps, correct sequencing, realistic for the stated difficulty level

DIETARY_COMPLIANCE (Every ingredient respects the user's dietary profile):
  1 = Contains user's allergen or excluded ingredient
  5 = Mostly compliant, one minor slip
  10 = Every ingredient verified against allergies, diet type, and dislikes

CREATIVITY (Recipe is interesting and well-suited to the user's context):
  1 = Generic, uncreative recipe with no personalisation
  5 = Decent recipe that meets the brief
  10 = Interesting, thoughtfully composed recipe clearly tailored to the request and constraints`;

// ─── Serialise recipe content for judge + assertions ─────────────────────────

function serialiseRecipe(
  recipe: Awaited<ReturnType<typeof generateRecipeContent>>,
): string {
  const parts: string[] = [
    `Title: ${recipe.title}`,
    `Description: ${recipe.description}`,
    `Difficulty: ${recipe.difficulty} | Time: ${recipe.timeEstimate}`,
  ];
  if (recipe.dietTags?.length) {
    parts.push(`Diet tags: ${recipe.dietTags.join(", ")}`);
  }
  parts.push(
    "Ingredients:\n" +
      recipe.ingredients
        .map((i) => `- ${i.quantity} ${i.unit} ${i.name}`.trim())
        .join("\n"),
  );
  parts.push(
    "Instructions:\n" +
      recipe.instructions.map((s, i) => `${i + 1}. ${s}`).join("\n"),
  );
  return parts.join("\n\n");
}

// ─── Load dataset and run ─────────────────────────────────────────────────────

const datasetPath = path.join(
  __dirname,
  "datasets",
  "recipe-generation-cases.json",
);
const rawJson = fs.readFileSync(datasetPath, "utf8");
let parsedJson: unknown;
try {
  parsedJson = JSON.parse(rawJson);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(
    `Error: recipe-generation-cases.json is not valid JSON: ${message}`,
  );
  process.exit(1);
}

const validation = recipeGenCasesSchema.safeParse(parsedJson);
if (!validation.success) {
  console.error(
    "Error: recipe-generation-cases.json failed schema validation:",
  );
  for (const issue of validation.error.errors) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

runEvalSuite(validation.data as unknown as EvalTestCase[], {
  suiteName: "recipe-generation",
  rubricText: RUBRIC_TEXT,
  dimensions: [
    "ingredient_coherence",
    "instruction_clarity",
    "dietary_compliance",
    "creativity",
  ],
  dimensionWeights: {
    ingredient_coherence: 1,
    instruction_clarity: 1,
    dietary_compliance: 2,
    creativity: 1,
  },
  inputTag: "recipe_request",
  outputTag: "generated_recipe",
  wordLimitWarning: 300,

  generateResponse: async (testCase: EvalTestCase) => {
    const i = testCase.input as RecipeGenInput;
    const serviceInput: RecipeGenerationInput = {
      productName: i.productName,
      servings: i.servings,
      timeConstraint: i.timeConstraint,
      dietPreferences: i.dietPreferences,
      userProfile: i.userProfile
        ? ({
            ...i.userProfile,
            allergies: i.userProfile.allergies.map((name) => ({
              name,
              severity: "moderate" as const,
            })),
          } as unknown as UserProfile)
        : null,
    };

    const start = Date.now();
    const recipe = await generateRecipeContent(serviceInput);
    const latencyMs = Date.now() - start;

    const text = serialiseRecipe(recipe);
    const wordCount = text.split(/\s+/).filter(Boolean).length;

    const structuredData = {
      ingredients: recipe.ingredients,
      instructions: recipe.instructions,
    };

    return { text, structuredData, latencyMs, wordCount };
  },

  formatInput: (testCase: EvalTestCase) => {
    const i = testCase.input as RecipeGenInput;
    const lines: string[] = [`Recipe request: ${i.productName}`];
    if (i.servings) lines.push(`Servings: ${i.servings}`);
    if (i.timeConstraint) lines.push(`Time constraint: ${i.timeConstraint}`);
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
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
