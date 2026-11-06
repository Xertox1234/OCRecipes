import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { classifyPhoto } from "../server/services/photo-analysis";
import { runEvalSuite } from "./lib/runner-core";
import { fetchImageAsJpegBase64 } from "./lib/fetch-image";
import type { EvalTestCase } from "./types";
import {
  photoClassifyCasesSchema,
  type LabelImageInput,
} from "./lib/dataset-schemas";

// ─── Rubric ───────────────────────────────────────────────────────────────────

const RUBRIC_TEXT = `You are an expert evaluator of an image classifier for a nutrition app. The case description says what the picture shows and which category the classifier should return (and any other acceptable category). The classifier picks exactly one of: prepared_meal, nutrition_label, restaurant_menu, raw_ingredients, grocery_receipt, restaurant_receipt, non_food, has_barcode.

CLASSIFICATION_ACCURACY (contentType matches the expected category):
  1 = A different category from the expected one and from any acceptable alternative
  5 = An acceptable alternative the description allows, but not the primary expected category
  10 = Exactly the expected category (for the barcode case, the barcode digits are also read exactly)

CONFIDENCE_CALIBRATION (confidence tracks how clear the category is). Confidence is a number from 0 to 1 where 1.0 means fully certain, so 0.95 is high confidence and 0.3 is low:
  1 = 0.9+ on a wrong category, or under 0.5 on a clear, unambiguous picture
  5 = Roughly tracks clarity but off by 0.2 or more
  10 = High for a clear picture of one category, clearly lower for an ambiguous or partial one`;

// ─── Serialise result for judge + assertions ──────────────────────────────────

function serialiseClassification(result: {
  contentType: string;
  confidence: number;
  barcode: string | null;
}): string {
  return [
    `contentType: ${result.contentType}`,
    `confidence: ${result.confidence}`,
    `barcode: ${result.barcode}`,
  ].join("\n");
}

// ─── Load dataset and run ─────────────────────────────────────────────────────

const datasetPath = path.join(
  __dirname,
  "datasets",
  "photo-classify-cases.json",
);
let parsedJson: unknown;
try {
  parsedJson = JSON.parse(fs.readFileSync(datasetPath, "utf8"));
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(
    `Error: photo-classify-cases.json is not valid JSON: ${message}`,
  );
  process.exit(1);
}

const validation = photoClassifyCasesSchema.safeParse(parsedJson);
if (!validation.success) {
  console.error("Error: photo-classify-cases.json failed schema validation:");
  for (const issue of validation.error.errors) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

runEvalSuite(validation.data as unknown as EvalTestCase[], {
  suiteName: "photo-classify",
  rubricText: RUBRIC_TEXT,
  dimensions: ["classification_accuracy", "confidence_calibration"],
  dimensionWeights: {
    classification_accuracy: 3,
    confidence_calibration: 1,
  },
  inputTag: "picture_description",
  outputTag: "classification_result",
  wordLimitWarning: 100,

  generateResponse: async (testCase: EvalTestCase) => {
    const i = testCase.input as LabelImageInput;
    const imageBase64 = await fetchImageAsJpegBase64(i.imageUrl, {
      // uploadPhotoForAnalysis in client/lib/photo-upload.ts calls
      // compressImage(uri) with no options: DEFAULT_OPTIONS in
      // client/lib/image-compression.ts (1024 px, quality 0.7)
      maxEdge: 1024,
      quality: 70,
    });
    const start = Date.now();
    // Step 1 of the app's classify-and-analyze flow: the photo-classify call
    // alone (the follow-on analysis runs other rows and is not measured here).
    const result = await classifyPhoto(imageBase64);
    const latencyMs = Date.now() - start;

    const text = serialiseClassification(result);
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
