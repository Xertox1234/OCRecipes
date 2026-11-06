import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { analyzeReceiptPhotos } from "../server/services/receipt-analysis";
import { runEvalSuite } from "./lib/runner-core";
import { fetchImageAsJpegBase64 } from "./lib/fetch-image";
import type { EvalTestCase } from "./types";
import {
  receiptScanCasesSchema,
  type LabelImageInput,
} from "./lib/dataset-schemas";

// ─── Rubric ───────────────────────────────────────────────────────────────────

const RUBRIC_TEXT = `You are an expert evaluator of grocery-receipt extraction. The case description lists the printed line items, the decoding a careful reader should reach, which lines are not food (to be excluded), and the store/date/total (all checked against the photo by hand). Compare the extraction with it. Shelf-life estimates and the exact category chosen among near neighbours are NOT scored.

ITEM_DECODING (the items, their decoded names, quantities, and the store/date/total):
  1 = Many printed products missing or invented; subtotal/tax/department-total/discount/voided lines reported as products; decoded names unrelated to the abbreviations
  5 = Most products present with plausible names, but several are missing, merged, or wrongly decoded; or a voided/discount/total line is reported as a purchase; or store, date or total is wrong
  10 = Every purchased product present once per printed line (or merged with the right quantity), decoded names are plausible readings of the abbreviations, weights/quantities as printed, voided and total/tax/discount lines are not products, and storeName, purchaseDate and totalAmount match the page (null where the page does not print them)

FOOD_CLASSIFICATION (the app keeps only the lines the model flags isFood true and drops the rest, so the extracted list is the food list; non-food products must therefore NOT appear in it):
  1 = Several non-food lines (napkins, plates, detergent, balloons, tissues) appear in the extracted list as food, or several real food lines are wrongly missing because they were flagged non-food
  5 = Mostly right with one or two non-food lines leaked into the list or food lines lost
  10 = No non-food product appears in the list, no food line is dropped as non-food, and categories for food lines are sensible

CONFIDENCE_CALIBRATION (confidence tracks how legible and unambiguous the receipt is). Confidence is a number from 0 to 1 where 1.0 means fully certain, so 0.95 is high confidence and 0.3 is low:
  1 = 0.9+ on a crumpled, faded or cryptically abbreviated receipt where several decodings are guesses, or under 0.5 on a clean, legible receipt
  5 = Roughly tracks legibility but off by 0.2 or more
  10 = High for a clean legible receipt; clearly lower for faded print, crumpled paper or cryptic abbreviations`;

// ─── Serialise result for judge + assertions ──────────────────────────────────

function serialiseReceipt(result: {
  items: {
    name: string;
    originalName: string;
    quantity: number;
    unit?: string;
    category: string;
    isFood: boolean;
    confidence: number;
  }[];
  storeName?: string;
  purchaseDate?: string;
  totalAmount?: string;
  isPartialExtraction: boolean;
  overallConfidence: number;
}): string {
  return [
    `storeName: ${result.storeName ?? null}`,
    `purchaseDate: ${result.purchaseDate ?? null}`,
    `totalAmount: ${result.totalAmount ?? null}`,
    `isPartialExtraction: ${result.isPartialExtraction}`,
    `overallConfidence: ${result.overallConfidence}`,
    `items (${result.items.length}):`,
    ...result.items.map(
      (i) =>
        `- name="${i.name}" original="${i.originalName}" qty=${i.quantity} unit=${i.unit ?? null} category=${i.category} isFood=${i.isFood} confidence=${i.confidence}`,
    ),
  ].join("\n");
}

// ─── Load dataset and run ─────────────────────────────────────────────────────

const datasetPath = path.join(__dirname, "datasets", "receipt-scan-cases.json");
let parsedJson: unknown;
try {
  parsedJson = JSON.parse(fs.readFileSync(datasetPath, "utf8"));
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: receipt-scan-cases.json is not valid JSON: ${message}`);
  process.exit(1);
}

const validation = receiptScanCasesSchema.safeParse(parsedJson);
if (!validation.success) {
  console.error("Error: receipt-scan-cases.json failed schema validation:");
  for (const issue of validation.error.errors) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

runEvalSuite(validation.data as unknown as EvalTestCase[], {
  suiteName: "receipt-scan",
  rubricText: RUBRIC_TEXT,
  dimensions: [
    "item_decoding",
    "food_classification",
    "confidence_calibration",
  ],
  dimensionWeights: {
    item_decoding: 2,
    food_classification: 2,
    confidence_calibration: 1,
  },
  inputTag: "receipt_description",
  outputTag: "extraction_result",
  wordLimitWarning: 900,

  generateResponse: async (testCase: EvalTestCase) => {
    const i = testCase.input as LabelImageInput;
    const imageBase64 = await fetchImageAsJpegBase64(i.imageUrl, {
      // useReceiptScan in client/hooks/useReceiptScan.ts
      maxEdge: 1536,
      quality: 85,
    });
    const start = Date.now();
    // One photo per call: the screen sends 1-3, and a single-photo scan is the
    // common case. Multi-photo scans are not covered by this suite.
    const result = await analyzeReceiptPhotos([imageBase64]);
    const latencyMs = Date.now() - start;

    const text = serialiseReceipt(result);
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
