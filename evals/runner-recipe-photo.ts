import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { analyzeRecipePhoto } from "../server/services/photo-analysis";
import { runEvalSuite } from "./lib/runner-core";
import { fetchImageAsJpegBase64 } from "./lib/fetch-image";
import type { EvalTestCase } from "./types";
import {
  recipePhotoCasesSchema,
  type LabelImageInput,
} from "./lib/dataset-schemas";

// ─── Rubric ───────────────────────────────────────────────────────────────────

const RUBRIC_TEXT = `You are an expert evaluator of recipe extraction from a photo of a written, typed or printed recipe. The case description transcribes what is on the page (checked against the photo by hand). Compare the extracted recipe with it. Estimated nutrition values and the description/cuisine/diet tags are NOT scored: the page does not print them.

INGREDIENT_FIDELITY (title and ingredient list match the page):
  1 = Wrong title, several ingredients missing or invented, or quantities and units changed (e.g. teaspoon read as tablespoon, 1/4 read as 1/2)
  5 = Title right and most ingredients present, but one or two ingredients missing/invented or a quantity/unit wrong, or a quantity the page does not show was invented
  10 = Title right; every printed ingredient present with its printed quantity and unit; nothing invented; a quantity the description says is missing or unreadable is null, not guessed

METHOD_FIDELITY (instructions, servings and times follow the page):
  1 = Steps missing or invented, a temperature or time changed, or servings/times made up when the page gives none
  5 = Steps broadly right but one step missing or an extra step invented, or one temperature/time/serving value wrong or made up
  10 = Every printed step is present in order with its printed temperature and time; nothing is added; servings, prepTimeMinutes and cookTimeMinutes are null unless the page gives them (a bake time printed in the method may fill cookTimeMinutes)

CONFIDENCE_CALIBRATION (The reported confidence tracks how readable and complete the page is). Confidence is a number from 0 to 1 where 1.0 means fully certain, so 0.95 is high confidence and 0.3 is low:
  1 = 0.9+ on a faded, handwritten or incomplete page with a missing or illegible quantity, or under 0.5 on a clean, fully legible page
  5 = Roughly tracks readability but off by 0.2 or more
  10 = High for a clean, complete, legible page; clearly lower for handwriting, faded print, or a page that is missing information`;

// ─── Serialise result for judge + assertions ──────────────────────────────────

function serialiseRecipe(result: {
  title: string;
  ingredients: { name: string; quantity: string | null; unit: string | null }[];
  instructions: string | null;
  servings: number | null;
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  confidence: number;
}): string {
  return [
    `title: ${result.title}`,
    `ingredients:`,
    ...result.ingredients.map(
      (i) => `- qty=${i.quantity} unit=${i.unit} name=${i.name}`,
    ),
    `instructions: ${result.instructions}`,
    `servings: ${result.servings}`,
    `prepTimeMinutes: ${result.prepTimeMinutes}`,
    `cookTimeMinutes: ${result.cookTimeMinutes}`,
    `confidence: ${result.confidence}`,
  ].join("\n");
}

// ─── Load dataset and run ─────────────────────────────────────────────────────

const datasetPath = path.join(__dirname, "datasets", "recipe-photo-cases.json");
let parsedJson: unknown;
try {
  parsedJson = JSON.parse(fs.readFileSync(datasetPath, "utf8"));
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: recipe-photo-cases.json is not valid JSON: ${message}`);
  process.exit(1);
}

const validation = recipePhotoCasesSchema.safeParse(parsedJson);
if (!validation.success) {
  console.error("Error: recipe-photo-cases.json failed schema validation:");
  for (const issue of validation.error.issues) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

runEvalSuite(validation.data as unknown as EvalTestCase[], {
  suiteName: "recipe-photo",
  rubricText: RUBRIC_TEXT,
  dimensions: [
    "ingredient_fidelity",
    "method_fidelity",
    "confidence_calibration",
  ],
  dimensionWeights: {
    ingredient_fidelity: 2,
    method_fidelity: 2,
    confidence_calibration: 1,
  },
  inputTag: "page_description",
  outputTag: "extraction_result",
  wordLimitWarning: 600,

  generateResponse: async (testCase: EvalTestCase) => {
    const i = testCase.input as LabelImageInput;
    const imageBase64 = await fetchImageAsJpegBase64(i.imageUrl, {
      // uploadRecipePhotoForAnalysis in client/lib/photo-upload.ts
      maxEdge: 1536,
      quality: 85,
    });
    const start = Date.now();
    const result = await analyzeRecipePhoto(imageBase64);
    const latencyMs = Date.now() - start;

    const text = serialiseRecipe(result);
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    return { text, structuredData: result, latencyMs, wordCount };
  },

  formatInput: (testCase: EvalTestCase) => {
    const i = testCase.input as LabelImageInput;
    return [
      `Description: ${testCase.description}`,
      `Image URL: ${i.imageUrl}`,
    ].join("\n");
  },
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
