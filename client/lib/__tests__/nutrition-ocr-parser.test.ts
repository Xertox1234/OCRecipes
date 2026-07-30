import { describe, it, expect } from "vitest";
import { parseNutritionFromOCR, isLabelReady } from "../nutrition-ocr-parser";

describe("parseNutritionFromOCR", () => {
  it("extracts all fields from a standard US nutrition label", () => {
    const text = `Nutrition Facts
Serving Size 1 cup (228g)
Servings Per Container 2
Calories 250
Total Fat 12g
  Saturated Fat 3g
  Trans Fat 0g
Cholesterol 30mg
Sodium 470mg
Total Carbohydrate 31g
  Dietary Fiber 0g
  Total Sugars 5g
Protein 5g`;

    const result = parseNutritionFromOCR(text);
    expect(result.calories).toBe(250);
    expect(result.totalFat).toBe(12);
    expect(result.saturatedFat).toBe(3);
    expect(result.transFat).toBe(0);
    expect(result.cholesterol).toBe(30);
    expect(result.sodium).toBe(470);
    expect(result.totalCarbs).toBe(31);
    expect(result.dietaryFiber).toBe(0);
    expect(result.totalSugars).toBe(5);
    expect(result.protein).toBe(5);
    expect(result.servingSize).toBe("1 cup (228g)");
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("handles decimal values", () => {
    const text = `Calories 120
Total Fat 1.5g
Saturated Fat 0.5g
Trans Fat 0g
Protein 2.5g`;

    const result = parseNutritionFromOCR(text);
    expect(result.totalFat).toBe(1.5);
    expect(result.saturatedFat).toBe(0.5);
    expect(result.protein).toBe(2.5);
  });

  it("handles common OCR misreads (O→0, l→1)", () => {
    const text = `Calories 25O
Total Fat l2g
Sodium 47Omg
Protein 5g`;

    const result = parseNutritionFromOCR(text);
    expect(result.calories).toBe(250);
    expect(result.totalFat).toBe(12);
    expect(result.sodium).toBe(470);
  });

  it("returns null fields for missing data and low confidence", () => {
    const text = `Calories 200
Protein 10g`;

    const result = parseNutritionFromOCR(text);
    expect(result.calories).toBe(200);
    expect(result.protein).toBe(10);
    expect(result.totalFat).toBeNull();
    expect(result.sodium).toBeNull();
    expect(result.totalCarbs).toBeNull();
    expect(result.confidence).toBeLessThan(0.6);
  });

  it("returns all-null with zero confidence for non-nutrition text", () => {
    const text = "Hello world this is not a nutrition label";

    const result = parseNutritionFromOCR(text);
    expect(result.calories).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it("returns all-null with zero confidence for empty string", () => {
    const result = parseNutritionFromOCR("");
    expect(result.confidence).toBe(0);
    expect(result.calories).toBeNull();
  });

  it("handles 'less than' values (e.g., <1g)", () => {
    const text = `Calories 50
Total Fat 0g
Trans Fat 0g
Cholesterol <5mg
Sodium 10mg
Total Carbohydrate 13g
  Dietary Fiber <1g
  Total Sugars 10g
Protein 0g`;

    const result = parseNutritionFromOCR(text);
    expect(result.cholesterol).toBe(5);
    expect(result.dietaryFiber).toBe(1);
  });

  it("handles values with percent daily value on same line", () => {
    const text = `Calories 140
Total Fat 8g 10%
  Saturated Fat 1g 5%
Sodium 200mg 9%
Total Carbohydrate 15g 5%
Protein 3g`;

    const result = parseNutritionFromOCR(text);
    expect(result.totalFat).toBe(8);
    expect(result.saturatedFat).toBe(1);
    expect(result.sodium).toBe(200);
    expect(result.totalCarbs).toBe(15);
  });

  it("handles 'Total Carb' and 'Total Carb.' abbreviations", () => {
    const text = `Calories 100
Total Carb. 20g
Protein 5g`;

    const result = parseNutritionFromOCR(text);
    expect(result.totalCarbs).toBe(20);
  });

  it("handles serving size on same line as label", () => {
    const text = `Serving Size 2/3 cup (55g)
Calories 230`;

    const result = parseNutritionFromOCR(text);
    expect(result.servingSize).toBe("2/3 cup (55g)");
    expect(result.calories).toBe(230);
  });

  it("handles S→5 OCR misread adjacent to digits", () => {
    const text = `Calories 2S0
Total Fat 1Sg`;

    const result = parseNutritionFromOCR(text);
    expect(result.calories).toBe(250);
    expect(result.totalFat).toBe(15);
  });

  it("rejects negative values from OCR misread", () => {
    const text = `Calories -120
Total Fat -5g
Protein 10g`;

    const result = parseNutritionFromOCR(text);
    expect(result.calories).toBeNull();
    expect(result.totalFat).toBeNull();
    expect(result.protein).toBe(10);
  });

  it("rejects unreasonably large values", () => {
    const text = `Calories 99999
Protein 5g`;

    const result = parseNutritionFromOCR(text);
    expect(result.calories).toBeNull();
    expect(result.protein).toBe(5);
  });

  it("returns null for garbage non-numeric data", () => {
    const text = `Calories abc
Total Fat --g
Sodium XYZmg`;

    const result = parseNutritionFromOCR(text);
    expect(result.calories).toBeNull();
    expect(result.totalFat).toBeNull();
    expect(result.sodium).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it("skips 'Calories from Fat' and extracts actual calories", () => {
    const text = `Calories from Fat 90
Calories 250
Total Fat 10g
Protein 5g`;

    const result = parseNutritionFromOCR(text);
    expect(result.calories).toBe(250);
  });

  it("caps serving size string length at 100 characters", () => {
    const longText = "A".repeat(200);
    const text = `Serving Size ${longText}
Calories 100`;

    const result = parseNutritionFromOCR(text);
    expect(result.servingSize).toHaveLength(100);
  });
});

describe("Canadian / bilingual labels", () => {
  it('extracts "Per 355 mL" serving', () => {
    const r = parseNutritionFromOCR(
      "Nutrition Facts\nPer 355 mL\nCalories 150",
    );
    expect(r.servingSize).toBe("355 mL");
    expect(r.calories).toBe(150);
  });

  it('extracts bilingual "Sugars / Sucres" and "Fat / Lipides"', () => {
    const r = parseNutritionFromOCR(
      "Per 355 mL\nCalories 150\nFat / Lipides 0 g\nSugars / Sucres 39 g",
    );
    expect(r.totalFat).toBe(0);
    expect(r.totalSugars).toBe(39);
  });

  it("handles accented French field names", () => {
    const r = parseNutritionFromOCR(
      "pour 250 mL\nProtéines 3 g\nGlucides 26 g",
    );
    expect(r.protein).toBe(3);
    expect(r.totalCarbs).toBe(26);
  });

  it("prefers 'Serving Size' over a 'Per' line when both are present", () => {
    const r = parseNutritionFromOCR("Amount per serving\nServing Size 30 g");
    expect(r.servingSize).toBe("30 g");
  });

  it("ignores a unit-less 'Per' line (the guard requires a g/ml token)", () => {
    // A "Per" line with no gram/ml token must NOT become the serving size.
    // With no "Serving Size" line present, the `??` cannot short-circuit, so
    // this actually exercises SERVING_PER_PATTERN's digit+unit guard.
    expect(
      parseNutritionFromOCR("Per serving\nCalories 100").servingSize,
    ).toBeNull();
  });

  it("keeps US-format labels working (no regression)", () => {
    const r = parseNutritionFromOCR(
      "Serving Size 1 cup (240g)\nCalories 100\nTotal Fat 2g\nTotal Sugars 12g",
    );
    expect(r.servingSize).toBe("1 cup (240g)");
    expect(r.totalSugars).toBe(12);
  });

  it("extracts all read fields from a full bilingual label without cross-field bleed", () => {
    // Distinct value per field so a line-anchor failure (bare "Fat" stealing the
    // "Saturated"/"Trans" sub-line, or "Sugars" stealing the "Carbohydrate"
    // value) flips an assertion. Mirrors the US full-label test for the
    // Canadian/bilingual format.
    const text = `Nutrition Facts / Valeur nutritive
Per 355 mL / pour 355 mL
Calories 150
Fat / Lipides 2 g
Saturated / saturés 1 g
Trans / trans 0.5 g
Carbohydrate / Glucides 39 g
Sugars / Sucres 38 g
Protein / Protéines 3 g`;
    const r = parseNutritionFromOCR(text);
    expect(r.calories).toBe(150);
    expect(r.totalFat).toBe(2); // not 1 (saturated) or 0.5 (trans) — bleed guard
    expect(r.saturatedFat).toBe(1); // bilingual sat-fat now parsed
    expect(r.totalCarbs).toBe(39); // not 38 (sugars)
    expect(r.totalSugars).toBe(38);
    expect(r.protein).toBe(3);
    expect(r.transFat).toBeNull(); // trans fat kept US-only (not read by feature)
    expect(r.servingSize).toContain("355 mL");
  });
});

/**
 * The label is the source of truth when one is present: its serving size and
 * calories are adopted over the product database (user decision, 2026-07-30).
 *
 * `isLabelReady` is the gate that decides whether a parse is used at all. It
 * used to also demand a sugars-or-fat reading, and that clause is what threw
 * away the real capture below.
 */
describe("isLabelReady — the label-is-source-of-truth gate", () => {
  /**
   * VERBATIM device OCR of a Cherry Coke can (barcode 06772408), captured on
   * 2026-07-30 from a physical iPhone via MLKit. Do not "clean up" this string:
   * every defect in it is real, and they are the point.
   *
   * The recogniser reads `g` as `9` (`0 9`, `39 9`) and `i` as `l` (`Ipldes`
   * for `Lipides`, `Glucldes` for `Glucides`, `Sodlum` for `Sodium`), and
   * splits `Carbohydrate` across two lines. Only 1 of 10 numeric field patterns
   * survives that — but the two fields this product decision cares about,
   * calories and serving size, both come through clean.
   */
  const CHERRY_COKE_DEVICE_OCR = `Nutrition Facts
Valeur n ttritive
Per 1 can (355 mL)
pour 1 canette (355 mL)
Calories 140
Fat / Ipldes 0 9
Carbe
hydrate / Glucldes 39g
Sugars Sucres 39 9
Protein /Protéines 0 9
Sodlum 30 mg`;

  it("accepts a real device capture that yields only calories and a serving size", () => {
    const parsed = parseNutritionFromOCR(CHERRY_COKE_DEVICE_OCR);

    // Both source-of-truth fields survived the noise.
    expect(parsed.calories).toBe(140);
    expect(parsed.servingSize).toContain("355 mL");
    // ...and essentially nothing else did. This is the shape the old gate rejected.
    expect(parsed.totalSugars).toBeNull();
    expect(parsed.totalFat).toBeNull();

    // Before this change the gate required (totalSugars ?? totalFat), so this
    // label was discarded and the screen fell back to the database's
    // per-100 mL figure — 39 kcal for a 140 kcal can.
    expect(isLabelReady(parsed)).toBe(true);
  });

  it("rejects a parse with no calories, even when a serving size was read", () => {
    // A front-of-pack shot: legible, has a volume, but no nutrition panel.
    const parsed = parseNutritionFromOCR(
      "CHERRY COKE ZERO SUGAR\nPer 1 can (355 mL)",
    );

    expect(parsed.calories).toBeNull();
    expect(isLabelReady(parsed)).toBe(false);
  });

  it("rejects a parse with calories but no serving size", () => {
    // Without a serving there is nothing to scale by, so adopting the calorie
    // figure would silently present it as whatever serving the DB assumed.
    const parsed = parseNutritionFromOCR("Nutrition Facts\nCalories 140");

    expect(parsed.calories).toBe(140);
    expect(parsed.servingSize).toBeNull();
    expect(isLabelReady(parsed)).toBe(false);
  });

  it("rejects a null parse (no label step ran, or OCR produced nothing)", () => {
    expect(isLabelReady(null)).toBe(false);
  });

  it("does not require sugars or fat — one recogniser glitch takes out both", () => {
    // `g`->`9` breaks the sugars AND fat patterns simultaneously, so requiring
    // "either one" is not the independent corroboration it looks like.
    const parsed = parseNutritionFromOCR(CHERRY_COKE_DEVICE_OCR);

    expect(parsed.totalSugars).toBeNull();
    expect(parsed.totalFat).toBeNull();
    expect(isLabelReady(parsed)).toBe(true);
  });

  /**
   * The gate must not be weaker than the server's. `isLabelReady` also
   * suppresses the "we couldn't use that label" notice, so a label it accepts
   * and `buildLabelConflict` then refuses reaches the user as database values
   * with NO indication the label was dropped — a server refusal returns the
   * same body shape as agreement.
   */
  it("rejects a serving that was captured but does not parse to grams/ml", () => {
    // A US label with no gram/ml figure on the serving line. Captured cleanly,
    // parses to nothing — and the server declines exactly this shape.
    const parsed = parseNutritionFromOCR(
      "Nutrition Facts\nServing Size 1 can\nCalories 140",
    );

    expect(parsed.calories).toBe(140);
    // The string WAS captured — this is precisely the trap: non-null, useless.
    expect(parsed.servingSize).toBe("1 can");
    expect(isLabelReady(parsed)).toBe(false);
  });
});
