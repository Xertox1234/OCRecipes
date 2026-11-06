import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { analyzeIngredientPhoto } from "../server/services/cooking-session";
import { runEvalSuite } from "./lib/runner-core";
import { fetchImageAsJpegBase64 } from "./lib/fetch-image";
import type { EvalTestCase } from "./types";
import {
  ingredientPhotoCasesSchema,
  type LabelImageInput,
} from "./lib/dataset-schemas";

// ─── Rubric ───────────────────────────────────────────────────────────────────

const RUBRIC_TEXT = `You are an expert evaluator of ingredient detection from a photo of raw cooking ingredients. The case description lists every ingredient visible in the picture, with counts and package sizes where they can be read (checked against the photo by hand). Compare the detected ingredients with it. Non-food objects (knives, bowls, whisks) are not ingredients.

ITEM_IDENTIFICATION (the detected ingredient list matches what is in the picture):
  1 = Most visible ingredients missing, or several ingredients invented that are not in the picture, or items badly misnamed (a different food)
  5 = Most main ingredients found, but two or three are missing, merged into a vague name, or one is invented or clearly misnamed
  10 = Every visible ingredient is found with a specific, correct name (a reasonable alternative for an ambiguous item is fine), nothing is invented, and non-food objects are not listed

QUANTITY_PLAUSIBILITY (quantity and unit for each ingredient are plausible for what is shown):
  1 = Counts and weights clearly wrong (a 1 kg bag as 100 g, 4 eggs as 12) for most items
  5 = Some quantities right, others off by a factor of two or more, or units that do not fit the item
  10 = Counts match what is visible, package sizes follow the printed labels, and estimates for loose items (a pile of diced carrot) are sensible

CONFIDENCE_CALIBRATION (each ingredient's confidence tracks how identifiable it is). Confidence is a number from 0 to 1 where 1.0 means fully certain, so 0.95 is high confidence and 0.3 is low:
  1 = 0.9+ on items the description calls ambiguous (parsnip vs parsley root, culantro, unlabeled powders), or low confidence on clearly labelled items
  5 = Roughly tracks identifiability but off by 0.2 or more for several items
  10 = High for clearly visible or labelled items, clearly lower for the ambiguous ones`;

// ─── Serialise result for judge + assertions ──────────────────────────────────

function serialiseIngredients(
  result: {
    name: string;
    quantity: number;
    unit: string;
    confidence: number;
    category: string;
  }[],
): string {
  return [
    `ingredients (${result.length}):`,
    ...result.map(
      (i) =>
        `- name="${i.name}" qty=${i.quantity} unit=${i.unit} category=${i.category} confidence=${i.confidence}`,
    ),
  ].join("\n");
}

// ─── Load dataset and run ─────────────────────────────────────────────────────

const datasetPath = path.join(
  __dirname,
  "datasets",
  "ingredient-photo-cases.json",
);
let parsedJson: unknown;
try {
  parsedJson = JSON.parse(fs.readFileSync(datasetPath, "utf8"));
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(
    `Error: ingredient-photo-cases.json is not valid JSON: ${message}`,
  );
  process.exit(1);
}

const validation = ingredientPhotoCasesSchema.safeParse(parsedJson);
if (!validation.success) {
  console.error("Error: ingredient-photo-cases.json failed schema validation:");
  for (const issue of validation.error.errors) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

runEvalSuite(validation.data as unknown as EvalTestCase[], {
  suiteName: "ingredient-photo",
  rubricText: RUBRIC_TEXT,
  dimensions: [
    "item_identification",
    "quantity_plausibility",
    "confidence_calibration",
  ],
  dimensionWeights: {
    item_identification: 2,
    quantity_plausibility: 1,
    confidence_calibration: 1,
  },
  inputTag: "photo_description",
  outputTag: "detected_ingredients",
  wordLimitWarning: 400,

  generateResponse: async (testCase: EvalTestCase) => {
    const i = testCase.input as LabelImageInput;
    const imageBase64 = await fetchImageAsJpegBase64(i.imageUrl, {
      // useAddCookPhoto in client/hooks/useCookSession.ts
      maxEdge: 1536,
      quality: 85,
    });
    const start = Date.now();
    // First photo of a session: currentPhotoCount 0, so the service sends
    // detail "high" (it drops to "low" from the fifth photo on).
    const result = await analyzeIngredientPhoto(imageBase64, "image/jpeg", 0);
    const latencyMs = Date.now() - start;

    const text = serialiseIngredients(result);
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
