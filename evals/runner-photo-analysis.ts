import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { analyzePhoto } from "../server/services/photo-analysis";
import { runEvalSuite } from "./lib/runner-core";
import type { EvalTestCase } from "./types";
import {
  photoAnalysisCasesSchema,
  type PhotoAnalysisInput,
} from "./lib/dataset-schemas";
import type { PhotoIntent } from "@shared/constants/preparation";

// ─── Rubric ───────────────────────────────────────────────────────────────────

const RUBRIC_TEXT = `You are an expert evaluator of AI food photo analysis responses.

Score the response on each requested dimension using a 1-10 scale with these anchors:

IDENTIFICATION_ACCURACY (Correctly names the foods visible in the image):
  1 = Completely wrong identification (e.g., calls pasta a vegetable)
  5 = Identifies the general food category but misses specifics (e.g., "chicken" for a chicken tikka)
  10 = Precisely identifies each food item (e.g., "grilled chicken breast", "basmati rice", "naan bread")

PORTION_PLAUSIBILITY (Portion size estimates are realistic for a typical serving):
  1 = Portion estimates are absurd (e.g., "10 cups of rice" for a small bowl)
  5 = Reasonable estimate but vague (e.g., "some rice" instead of "1 cup")
  10 = Specific, realistic portion estimates using standard US measurements (e.g., "1 cup cooked basmati rice", "4 oz grilled chicken")

CONFIDENCE_CALIBRATION (Confidence score matches how clearly the food is identifiable):
  1 = Confidence of 0.9+ on a blurry or ambiguous image, or 0.2 on a crystal-clear photo
  5 = Confidence roughly tracks image clarity but over- or under-shoots by 0.2+
  10 = Confidence accurately reflects the actual identifiability — high on clear images, lower on ambiguous ones`;

// ─── Image fetch helper ───────────────────────────────────────────────────────

/**
 * Fetch a public image URL and return it as base64-encoded JPEG data.
 * Throws on non-2xx status so the case errors loudly if a URL 404s.
 */
async function fetchImageAsBase64(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch image from ${url}: HTTP ${response.status}`,
    );
  }
  const buffer = await response.arrayBuffer();
  return Buffer.from(buffer).toString("base64");
}

// ─── Serialise result for judge + assertions ──────────────────────────────────

function serialiseAnalysisResult(result: {
  foods: {
    name: string;
    quantity: string;
    confidence: number;
    needsClarification: boolean;
    category?: string;
    cuisine?: string;
  }[];
  overallConfidence: number;
  followUpQuestions: string[];
}): string {
  const parts: string[] = [
    `Overall confidence: ${result.overallConfidence.toFixed(2)}`,
  ];

  if (result.foods.length === 0) {
    parts.push("Foods: (none identified)");
  } else {
    const foodLines = result.foods.map((f) => {
      const parts: string[] = [`${f.name} (${f.quantity})`];
      if (f.category) parts.push(`category: ${f.category}`);
      if (f.cuisine) parts.push(`cuisine: ${f.cuisine}`);
      parts.push(`confidence: ${f.confidence.toFixed(2)}`);
      return `- ${parts.join(", ")}`;
    });
    parts.push("Foods:\n" + foodLines.join("\n"));
  }

  if (result.followUpQuestions.length > 0) {
    parts.push(
      "Follow-up questions:\n" +
        result.followUpQuestions.map((q) => `- ${q}`).join("\n"),
    );
  }

  return parts.join("\n\n");
}

// ─── Load dataset and run ─────────────────────────────────────────────────────

const datasetPath = path.join(
  __dirname,
  "datasets",
  "photo-analysis-cases.json",
);
const rawJson = fs.readFileSync(datasetPath, "utf8");
let parsedJson: unknown;
try {
  parsedJson = JSON.parse(rawJson);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(
    `Error: photo-analysis-cases.json is not valid JSON: ${message}`,
  );
  process.exit(1);
}

const validation = photoAnalysisCasesSchema.safeParse(parsedJson);
if (!validation.success) {
  console.error("Error: photo-analysis-cases.json failed schema validation:");
  for (const issue of validation.error.errors) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

runEvalSuite(validation.data as unknown as EvalTestCase[], {
  suiteName: "photo-analysis",
  rubricText: RUBRIC_TEXT,
  dimensions: [
    "identification_accuracy",
    "portion_plausibility",
    "confidence_calibration",
  ],
  dimensionWeights: {
    identification_accuracy: 2,
    portion_plausibility: 1,
    confidence_calibration: 1,
  },
  inputTag: "image_description",
  outputTag: "analysis_result",
  wordLimitWarning: 200,

  generateResponse: async (testCase: EvalTestCase) => {
    const i = testCase.input as PhotoAnalysisInput;
    const imageBase64 = await fetchImageAsBase64(i.imageUrl);
    const start = Date.now();
    const result = await analyzePhoto(imageBase64, i.intent as PhotoIntent);
    const latencyMs = Date.now() - start;

    const text = serialiseAnalysisResult(result);
    const wordCount = text.split(/\s+/).filter(Boolean).length;

    const structuredData = {
      foods: result.foods,
      overallConfidence: result.overallConfidence,
    };

    return { text, structuredData, latencyMs, wordCount };
  },

  formatInput: (testCase: EvalTestCase) => {
    const i = testCase.input as PhotoAnalysisInput;
    return [
      `Description: ${testCase.description}`,
      `Image URL: ${i.imageUrl}`,
      `Intent: ${i.intent}`,
    ].join("\n");
  },
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
