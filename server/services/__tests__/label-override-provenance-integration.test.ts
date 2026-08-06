/**
 * The parser -> payload -> server seam, end to end.
 *
 * The two suites either side of it (`client/lib/__tests__/nutrition-ocr-parser.test.ts`
 * and `label-override.test.ts`) use disjoint hand-written fixtures, so nothing
 * covered the join: the parser suite never builds a payload, and the override
 * suite never runs the parser. That is precisely where the provenance channel
 * lives, and an inert `directReads` — never populated, never sent, or sent
 * under a name the server does not read — would be invisible to both.
 *
 * So this file starts from raw OCR text, runs the real parser, builds the real
 * POST body via the real `toLabelNutritionPayload`, and hands it to the real
 * `buildLabelConflict`. No value is restated by hand anywhere in between.
 */
import { it, expect } from "vitest";
import {
  parseNutritionFromOCR,
  toLabelNutritionPayload,
} from "../../../client/lib/nutrition-ocr-parser";
import { buildLabelConflict } from "../label-override";
import type { BarcodeLookupResult } from "../barcode-lookup";

/**
 * The SAME panel, twice, differing in exactly one glyph.
 *
 * MLKit reads the "g" unit as a "9" often enough that it is the single largest
 * cause of dropped fields, so "Saturated Fat 69" is a device-realistic capture
 * of a 6 g line. The parser cannot read it directly — "69" is genuinely
 * ambiguous — so it goes to the second pass, where `gluedUnitIsForced` INFERS
 * 6 from the containment bound that 69 g of saturated fat cannot fit inside the
 * 10 g of total fat the same panel reports.
 *
 * Both texts therefore yield `saturatedFat: 6`. Everything downstream is
 * identical. The only thing that differs is how the 6 was arrived at — which is
 * the whole point: without provenance on the wire the server cannot tell these
 * two apart, and the inference's error is bounded by `[0, totalFat]` while the
 * comparison's tolerance is sized for a 0.5 g printing step.
 */
const PANEL_WITH_INFERRED_SATURATED_FAT = `Serving Size 30 g
Calories 121
Total Fat 10 g
Saturated Fat 69`;

const PANEL_WITH_DIRECT_SATURATED_FAT = `Serving Size 30 g
Calories 121
Total Fat 10 g
Saturated Fat 6 g`;

/** Cheddar-like record: agrees with the panel on calories and fat, and carries
 *  a saturatedFat far below the label's (6 g / 30 g = 20 per-100 vs 2). */
function db(): BarcodeLookupResult {
  return {
    productName: "Cheddar",
    barcode: "06772408",
    per100g: {
      calories: 380, // within 25% of the label's ~403.3
      fat: 30, // within 25% of the label's ~33.3
      saturatedFat: 2, // vs the label's 20 — an 18 g/100g gap
      carbs: 2,
      protein: 24,
      sodium: 650,
    },
    perServing: { calories: 106, fat: 8.4 },
    servingInfo: { displayLabel: "28 g", grams: 28, wasCorrected: false },
    isServingDataTrusted: true,
    source: "openfoodfacts",
    allergenDataAvailable: true,
    categoriesTags: ["en:cheeses"],
  };
}

it("parses the same saturatedFat VALUE from both panels — only the provenance differs", () => {
  // The premise every assertion below rests on. If the parser ever stopped
  // resolving the glued form, or started counting the inference as a direct
  // read, the two tests after this would still pass for the wrong reason.
  const inferred = parseNutritionFromOCR(PANEL_WITH_INFERRED_SATURATED_FAT);
  const direct = parseNutritionFromOCR(PANEL_WITH_DIRECT_SATURATED_FAT);

  expect(inferred.saturatedFat).toBe(6);
  expect(direct.saturatedFat).toBe(6);

  expect(inferred.directReads).not.toContain("saturatedFat");
  expect(direct.directReads).toContain("saturatedFat");
  // Both read calories and total fat off the panel either way.
  expect(inferred.directReads).toContain("totalFat");

  // `directReads` is exactly the set that counted toward `confidence` — one
  // notion of "we actually read this", not two. The inferred panel read two of
  // the ten fields, the direct one three.
  expect(inferred.confidence).toBeCloseTo(2 / 10, 10);
  expect(direct.confidence).toBeCloseTo(3 / 10, 10);
});

it("an INFERRED saturatedFat reaches the server but is not compared against the record", () => {
  const payload = toLabelNutritionPayload(
    parseNutritionFromOCR(PANEL_WITH_INFERRED_SATURATED_FAT),
  );
  // It IS sent — provenance gates the comparison, not the reading.
  expect(payload.saturatedFat).toBe(6);
  expect(payload.directReads).not.toContain("saturatedFat");

  const r = buildLabelConflict(db(), payload);
  // An 18 g/100g gap that would dwarf any rounding floor, and it raises nothing:
  // the row was skipped. Without this the record's carbs, protein and sodium
  // would be at the mercy of a containment inference.
  expect(r.conflict).toBe(false);
  expect(r.fields).toEqual([]);
});

it("a DIRECT saturatedFat read from the same panel IS compared, and conflicts", () => {
  const payload = toLabelNutritionPayload(
    parseNutritionFromOCR(PANEL_WITH_DIRECT_SATURATED_FAT),
  );
  expect(payload.saturatedFat).toBe(6);
  expect(payload.directReads).toContain("saturatedFat");

  const r = buildLabelConflict(db(), payload);
  expect(r.conflict).toBe(true);
  expect(r.fields).toEqual(["saturatedFat"]);
  // The label's value is adopted...
  expect(r.labelResult!.per100g.saturatedFat).toBeCloseTo(20, 5);
  // ...and, since nothing corroborating disagreed, the record's un-read macros
  // survive rather than being blanked.
  expect(r.labelResult!.per100g.protein).toBe(24);
  expect(r.labelResult!.per100g.sodium).toBe(650);
});
