import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { analyzeFrontLabel } from "../server/services/front-label-analysis";
import { runEvalSuite } from "./lib/runner-core";
import { fetchImageAsJpegBase64 } from "./lib/fetch-image";
import type { EvalTestCase } from "./types";
import {
  frontLabelCasesSchema,
  type LabelImageInput,
} from "./lib/dataset-schemas";

// ─── Rubric ───────────────────────────────────────────────────────────────────

const RUBRIC_TEXT = `You are an expert evaluator of product-package front-label extraction. The case description lists exactly what is printed on the package front (checked against the photo by hand). Compare the extracted fields with it.

FIELD_ACCURACY (brand, productName and netWeight match what is printed; absent fields are null):
  1 = Wrong brand or product, or an invented net weight
  5 = Brand right but the product name is partial or wrong, or the net weight is misread
  10 = Brand, product name and net weight all match the description, and fields it says are unreadable are null

CLAIMS_FIDELITY (claims lists only claims explicitly printed on the package front, as printed):
  1 = Several claims that are not printed (e.g. "Organic", "Vegan", "Gluten Free" inferred from the product type), or printed claims reworded into different claims
  5 = Every claim is printed but one or two printed claims are missed, or one invented claim appears
  10 = Every claim is printed on the package, wording is faithful, and promotional text (prices, QR calls) is not reported as a dietary claim

CONFIDENCE_CALIBRATION (The reported confidence tracks how readable and unambiguous the package is). Confidence is a number from 0 to 1 where 1.0 means fully certain, so 0.95 is high confidence and 0.3 is low:
  1 = 0.9+ on a blurry, unbranded or multi-product frame, or under 0.5 on a clear single product
  5 = Roughly tracks readability but off by 0.2 or more
  10 = High for a clear single product, clearly lower for ambiguous, partial or unbranded frames`;

// ─── Serialise result for judge + assertions ──────────────────────────────────

function serialiseFrontLabel(result: {
  brand: string | null;
  productName: string | null;
  netWeight: string | null;
  claims: string[];
  confidence: number;
}): string {
  return [
    `brand: ${result.brand}`,
    `productName: ${result.productName}`,
    `netWeight: ${result.netWeight}`,
    `claims: ${result.claims.length > 0 ? result.claims.join(" | ") : "(none)"}`,
    `confidence: ${result.confidence}`,
  ].join("\n");
}

// ─── Load dataset and run ─────────────────────────────────────────────────────

const datasetPath = path.join(__dirname, "datasets", "front-label-cases.json");
let parsedJson: unknown;
try {
  parsedJson = JSON.parse(fs.readFileSync(datasetPath, "utf8"));
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: front-label-cases.json is not valid JSON: ${message}`);
  process.exit(1);
}

const validation = frontLabelCasesSchema.safeParse(parsedJson);
if (!validation.success) {
  console.error("Error: front-label-cases.json failed schema validation:");
  for (const issue of validation.error.issues) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

runEvalSuite(validation.data as unknown as EvalTestCase[], {
  suiteName: "front-label",
  rubricText: RUBRIC_TEXT,
  dimensions: ["field_accuracy", "claims_fidelity", "confidence_calibration"],
  dimensionWeights: {
    field_accuracy: 2,
    claims_fidelity: 2,
    confidence_calibration: 1,
  },
  inputTag: "package_description",
  outputTag: "extraction_result",
  wordLimitWarning: 200,

  generateResponse: async (testCase: EvalTestCase) => {
    const i = testCase.input as LabelImageInput;
    const imageBase64 = await fetchImageAsJpegBase64(i.imageUrl, {
      // uploadFrontLabelPhoto in client/lib/photo-upload.ts
      maxEdge: 1024,
      quality: 80,
    });
    const start = Date.now();
    const result = await analyzeFrontLabel(imageBase64);
    const latencyMs = Date.now() - start;

    const text = serialiseFrontLabel(result);
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
