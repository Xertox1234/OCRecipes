import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { analyzeLabelPhoto } from "../server/services/photo-analysis";
import { runEvalSuite } from "./lib/runner-core";
import { fetchImageAsJpegBase64 } from "./lib/fetch-image";
import type { EvalTestCase } from "./types";
import {
  labelExtractionCasesSchema,
  type LabelImageInput,
} from "./lib/dataset-schemas";

// ─── Rubric ───────────────────────────────────────────────────────────────────

const RUBRIC_TEXT = `You are an expert evaluator of nutrition-label extraction. The case description lists exactly what is printed on the label (checked against the photo by hand). Compare the extracted fields with it.

EXTRACTION_ACCURACY (Do the extracted numbers and the serving size match what is printed?):
  1 = Most values wrong, swapped between rows, or taken from the wrong column (e.g. calories from fat used as calories)
  5 = About half of the printed values are right, or several values are off by a row or a unit
  10 = Every value that is printed and readable matches the description exactly, including the serving size text and servings per container

NULL_DISCIPLINE (Fields that are not printed or not readable are null, never invented):
  1 = Many invented values: zeros or estimates for rows that are not on the label, or calories computed from macros
  5 = One or two invented values, or a percent daily value copied into a gram/milligram field
  10 = Every field the description says is absent is null, and nothing printed was dropped without reason

CONFIDENCE_CALIBRATION (The reported confidence tracks how readable the label is). Confidence is a number from 0 to 1 where 1.0 means fully certain, so 0.95 is high confidence and 0.3 is low:
  1 = 0.9+ on a crumpled, cut-off or glare-covered label, or under 0.5 on a flat, clear one
  5 = Roughly tracks readability but off by 0.2 or more
  10 = High on flat clear labels, clearly lower on partial, skewed or low-resolution ones`;

// ─── Serialise result for judge + assertions ──────────────────────────────────

const FIELDS = [
  "servingSize",
  "servingsPerContainer",
  "calories",
  "totalFat",
  "saturatedFat",
  "transFat",
  "cholesterol",
  "sodium",
  "totalCarbs",
  "dietaryFiber",
  "totalSugars",
  "addedSugars",
  "protein",
  "vitaminD",
  "calcium",
  "iron",
  "potassium",
  "confidence",
  "productName",
] as const;

function serialiseLabel(result: Record<string, unknown>): string {
  return FIELDS.map(
    (f) => `${f}: ${result[f] === undefined ? null : result[f]}`,
  ).join("\n");
}

// ─── Load dataset and run ─────────────────────────────────────────────────────

const datasetPath = path.join(
  __dirname,
  "datasets",
  "label-extraction-cases.json",
);
let parsedJson: unknown;
try {
  parsedJson = JSON.parse(fs.readFileSync(datasetPath, "utf8"));
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(
    `Error: label-extraction-cases.json is not valid JSON: ${message}`,
  );
  process.exit(1);
}

const validation = labelExtractionCasesSchema.safeParse(parsedJson);
if (!validation.success) {
  console.error("Error: label-extraction-cases.json failed schema validation:");
  for (const issue of validation.error.errors) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

runEvalSuite(validation.data as unknown as EvalTestCase[], {
  suiteName: "label-extraction",
  rubricText: RUBRIC_TEXT,
  dimensions: [
    "extraction_accuracy",
    "null_discipline",
    "confidence_calibration",
  ],
  dimensionWeights: {
    extraction_accuracy: 2,
    null_discipline: 2,
    confidence_calibration: 1,
  },
  inputTag: "label_description",
  outputTag: "extraction_result",
  wordLimitWarning: 200,

  generateResponse: async (testCase: EvalTestCase) => {
    const i = testCase.input as LabelImageInput;
    const imageBase64 = await fetchImageAsJpegBase64(i.imageUrl, {
      // uploadLabelForAnalysis in client/lib/photo-upload.ts
      maxEdge: 1536,
      quality: 85,
    });
    const start = Date.now();
    const result = await analyzeLabelPhoto(imageBase64);
    const latencyMs = Date.now() - start;

    const text = serialiseLabel(result as unknown as Record<string, unknown>);
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
