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
    expect(r.transFat).toBe(0.5); // bilingual trans fat now parsed, not 2/1/39/38
    expect(r.servingSize).toContain("355 mL");
  });
});

/**
 * VERBATIM MLKit output from `probeLabelRead` on a physical iPhone 16 Pro Max
 * (EAS dev client `3967b6cd`), captured 2026-08-05. Do not "clean up" these
 * strings — every defect in them is real and load-bearing, and the research
 * note they came from is gitignored, so this file is the only copy in the repo.
 *
 * Both labels ALREADY passed `isLabelReady` before this change (calories and a
 * parseable serving both survived), so what these tests pin down is not
 * *whether* the label is used but *which fields survive the parse* — 2 of 10
 * and 3 of 10 respectively, on labels a human reads without difficulty.
 *
 * Assertions that still expect `null` name their cause. They are the ledger for
 * the remaining known defects, and each one flips to a value when its cause is
 * fixed:
 *   - `g` -> `9`: the recogniser reads the unit as a digit ("2.59" for "2.5 g",
 *     "9 9" for "9 g"). Known since 2026-07-30 (Cherry Coke, above).
 *   - column merge: MLKit flattens physically adjacent print columns into one
 *     line, so the ingredients panel bleeds into the serving-size line.
 */
describe("device captures — 2026-08-05 bilingual Canadian labels", () => {
  /** Canola/olive mayonnaise-style dressing. */
  const MAYONNAISE_DEVICE_OCR = `MACEIN CANAOA WITH DOMESTIC AND IMPORTED INGREDIENTS / FAIT AU CANADA AVEC DES NGRÉIENSM
"ABLEND OF CANOLA & OUVE ONLS / UN MÉLANGE D'HUILE DE CANOLA ETDHILE ETUIE
Nutrition Facts
Valeur nutritive
Per 1 tbsp (15 mL)/par 1 c. à s. (15 mL) Sugar, Vinegar, Splu Lguit et y
% Daily Value* lemon juns faV
% valeur quotídienne*EDTA (Ma
Calories 100
Fat /Lipides 11 g
Saturated/ saturés 19
+Trans / trans 0 g
Polyunsaturated / polyinsaturés 3 9
Omega-6/oméga-62 g
Omega-3/ oméga-3 0.8 g
Monounsaturated / mono-insaturés b g
Carbohydrate /Glucides 09
Protein / Protéines 0.2 9
Cholesterol /Cholestérol 5 mg
Sodium 85 mg
Not a significant source of fibre, suga ars
potassium, calcium or iron.
Source négligeable de fibre,
potassium, calcium ou fer.
SUcres,
5% or less is a little. 15% or more
a lot / *5% ou moins c'est peu,
plus c'est beaucoup
15
%
ou
15 %
5 %
Contalins: Egg.
Ingrédients:Huile te
d'o a eut ente
Vinaiare Jaune 1 B
Sel Sucre ioie s
Concentré
dlsodiaue aintent as
COntiantau
19
Ingredients: Canola
oil, Water Ligut wtok
Cancentatt
GLUTEN FREE
SANS GLUTEN
NO TRANSFAT
SANS GRASTRANS
\\oWINSATURATED FAT
FAIBLE EN GRAS SATURES
\\OHHIN
HOLESTEROL
FABLE EN CHOLESTEROI
FAibNC
SOURCE OF OMEGA-3
SOURCE DOMEGA-3`;

  /** Little Saigon sauce, Abbotsford BC. */
  const SAUCE_DEVICE_OCR = `Nutrition Facts
Valeur nutritive
Per 30 ml (30 g)
pour 30 ml (30 g)
Servings per Container
Portions par contenant
Calories 60
Total Fat / Lipides 2.59
saturés 0.4g
Saturated/
+ Trans / trans 0 g
Glucides 9 9
Carbohydrate /
Fiber / Fibres 1 g
Sugars / Sucres 7 g
s2 g
Protein | Protéine
iOlesterol / Cholestérol 0 mg
Sodium 400 mg
|Potassium 50 mg
Calcium 10 mg
|Iron / Fer 0.2 mg
or less is a little. 15% or more Is a lot beau
S C'est peu, 15% ou plus c'est beaucoup
LO% ou moins cest peu
"59%
LITTLE SAIGON RESTAUHT
RBBOTSFORD, BC V2S 2H2
EFRIDGERATE AETER OPENING /RÉFRIOÉRER UNE FO)
Www.LITLESAIGON.CA
E FOIS DUVEAI
BRIZ
C863409800
Supps by BCID
NE
% Daily Value
% valeur quotidienne"
49
7%
17%
1 %/
15
1%/`;

  it("reads the spaced-unit fields the old patterns could not match (mayonnaise)", () => {
    const r = parseNutritionFromOCR(MAYONNAISE_DEVICE_OCR);

    // `(\S+?)mg` could not cross the space in "85 mg" / "5 mg", so both of
    // these parsed null on a label the recogniser had read perfectly.
    expect(r.sodium).toBe(85);
    expect(r.cholesterol).toBe(5);
    // "+Trans / trans 0 g" — needed the bilingual form AND the leading marker.
    expect(r.transFat).toBe(0);
    // Unchanged, and asserted so the new alternations can't steal these.
    expect(r.calories).toBe(100);
    expect(r.totalFat).toBe(11);
  });

  it("reads the separated g→9 form on the mayonnaise label", () => {
    const r = parseNutritionFromOCR(MAYONNAISE_DEVICE_OCR);

    // "Protéines 0.2 9" — the "9" is a lone token, so it can only be the unit.
    expect(r.protein).toBe(0.2);
  });

  it("resolves the glued g→9 forms the label itself rules out (mayonnaise)", () => {
    const r = parseNutritionFromOCR(MAYONNAISE_DEVICE_OCR);

    // "Glucides 09" is "Glucides 0 g". A printed panel never puts a leading
    // zero in front of another digit, so "09" is not a value any label could
    // carry — the trailing glyph has to be the unit.
    expect(r.totalCarbs).toBe(0);
    // "saturés 19" is "saturés 1 g". 19 g of saturated fat cannot fit inside
    // the 11 g of total fat this same label reports, so the whole-token
    // reading is impossible and only the unit reading survives.
    //
    // Asserted alongside it because it is load-bearing, not context: lose
    // totalFat on this capture and saturatedFat silently reverts to null.
    // Without this line that shows up as a confidence failure somewhere else.
    expect(r.totalFat).toBe(11);
    expect(r.saturatedFat).toBe(1);
  });

  it("keeps the ingredients panel out of the serving size (mayonnaise)", () => {
    const r = parseNutritionFromOCR(MAYONNAISE_DEVICE_OCR);

    // MLKit flattens adjacent print columns, so the ingredients panel lands on
    // the serving line: "Per 1 tbsp (15 mL)/par 1 c. à s. (15 mL) Sugar,
    // Vinegar, Splu Lguit et y". A serving spec ends at its last unit token;
    // everything past it is another column. This string is displayed AND
    // posted in the label-override payload.
    expect(r.servingSize).toBe("1 tbsp (15 mL)/par 1 c. à s. (15 mL)");
  });

  it("does not read a fibre disclaimer as a fibre value (line-anchor guard)", () => {
    const r = parseNutritionFromOCR(MAYONNAISE_DEVICE_OCR);

    // This label carries "Not a significant source of fibre, suga ars" and
    // "Source négligeable de fibre," — neither line-initial. The bare bilingual
    // "fibre" token is line-anchored precisely so a disclaimer cannot supply a
    // number. Dropping that anchor makes this assertion fail.
    expect(r.dietaryFiber).toBeNull();
    // Same shape: "SUcres," is line-initial but carries no value.
    expect(r.totalSugars).toBeNull();
  });

  it("reads the spaced-unit and bilingual fields on the sauce label", () => {
    const r = parseNutritionFromOCR(SAUCE_DEVICE_OCR);

    expect(r.sodium).toBe(400); // was null: "400 mg" has a space
    expect(r.dietaryFiber).toBe(1); // was null: "Fiber / Fibres 1 g"
    expect(r.transFat).toBe(0); // was null: "+ Trans / trans 0 g"
    // The English name is mangled to "iOlesterol"; only the French half is
    // legible, so this field is readable ONLY via the bilingual alternation.
    expect(r.cholesterol).toBe(0);
    // Unchanged.
    expect(r.calories).toBe(60);
    expect(r.saturatedFat).toBe(0.4);
    expect(r.totalSugars).toBe(7);
  });

  it("reads the separated g→9 form on the sauce label", () => {
    const r = parseNutritionFromOCR(SAUCE_DEVICE_OCR);

    // "Glucides 9 9" — value and unit are BOTH rendered as the glyph "9".
    // Requiring the unit to be a lone whitespace-preceded token resolves it.
    expect(r.totalCarbs).toBe(9);
  });

  it("still cannot read the glued g→9 and column-merged fields on the sauce label", () => {
    const r = parseNutritionFromOCR(SAUCE_DEVICE_OCR);

    // "Lipides 2.59" is "Lipides 2.5 g" — the same glued shape the two
    // mayonnaise fields above now resolve, but with no evidence against the
    // whole-token reading: 2.59 carries no leading zero, and totalFat is the
    // parent of the fat sub-fields, so nothing bounds it from above. Distin-
    // guishing it needs a rule about label printing precision, which is a
    // claim about regulation rather than about this text. Declined, not
    // guessed — totalFat is in the server-override payload.
    expect(r.totalFat).toBeNull();
    // MLKit split the column: the value ("s2 g") landed on the line BEFORE the
    // name, and the separator is "|" rather than "/". Reading backwards would
    // not help — `fixOCRDigits` leaves a lowercase "s" alone, so "s2" is NaN
    // and the field stays null. Recovering the 2 means stripping the "s",
    // which contradicts the same table's S→5 rule ("S2" parses as 52).
    expect(r.protein).toBeNull();
  });

  it("lifts both labels over the 0.6 local-preview confidence gate", () => {
    // `LabelAnalysisScreen` shows an instant local preview only at >= 0.6.
    // Sauce: 3/10 fields originally, 7/10 after the spaced-unit fix, 8/10 now.
    expect(parseNutritionFromOCR(SAUCE_DEVICE_OCR).confidence).toBeCloseTo(0.8);
    // Mayonnaise: 2/10 originally, 5/10 after the spaced-unit fix, 6/10 after
    // the separated g→9 fix — and still 6/10 here, sitting exactly on the
    // threshold, even though its glued saturated-fat and carbohydrate fields
    // now resolve. Those two are INFERRED, and confidence counts only what was
    // read. It is a measure of how much of the panel the recogniser actually
    // delivered, so an inference must not be able to lift a label over the gate
    // that decides whether the user is shown a preview at all.
    const mayo = parseNutritionFromOCR(MAYONNAISE_DEVICE_OCR);
    expect(mayo.confidence).toBeCloseTo(0.6);
    // The fields are populated regardless — the two are independent.
    expect(mayo.saturatedFat).toBe(1);
    expect(mayo.totalCarbs).toBe(0);
  });
});

/**
 * A GLUED `g` -> `9` ("saturés 19") has two readings — "1 g" and "19" — and the
 * flattened text alone cannot separate them. These tests pin the two pieces of
 * evidence that CAN, and, just as importantly, every neighbouring case where
 * that evidence is absent and the parser must still decline.
 *
 * Both sides of each boundary are asserted on purpose. The last defect this
 * file shipped green was a tolerance whose suite only exercised the side that
 * passed; the side that mattered was never written down.
 */
describe("glued g→9 — resolving only what the label itself rules out", () => {
  describe("leading-zero evidence", () => {
    it("resolves a glued form no label could have printed", () => {
      // "09" cannot be a printed value: panels write "0 g", never "09 g".
      expect(parseNutritionFromOCR("Carbohydrate 09").totalCarbs).toBe(0);
    });

    it("declines when the remainder is no more printable than the whole", () => {
      // "019" is not a value a panel could print — but neither is the "01"
      // left behind once the trailing glyph is called the unit. Both readings
      // are impossible, so the token is garbage and resolving it would invent
      // a number rather than recover one.
      expect(parseNutritionFromOCR("Carbohydrate 019").totalCarbs).toBeNull();
      expect(parseNutritionFromOCR("Carbohydrate 0199").totalCarbs).toBeNull();
    });

    it("cannot manufacture a parent that then promotes a child", () => {
      // The containment test below reads whatever is in the result, without
      // knowing how it got there. That is only safe while no rule here can
      // invent a parent: "Carbohydrate 019" must not resolve to 1 and license
      // "Sugars 19" — a fabricated bound promoting a genuinely ambiguous child.
      const r = parseNutritionFromOCR("Carbohydrate 019\nSugars 19");
      expect(r.totalCarbs).toBeNull();
      expect(r.totalSugars).toBeNull();
      // Same shape on the fat side.
      const f = parseNutritionFromOCR("Total Fat 019\nSaturated 19");
      expect(f.totalFat).toBeNull();
      expect(f.saturatedFat).toBeNull();
    });

    it("declines when the leading zero is a real decimal", () => {
      // "0.59" has a leading zero too, but it is followed by "." — a perfectly
      // printable value. The rule is a zero before a DIGIT, nothing looser.
      expect(parseNutritionFromOCR("Total Fat 0.59").totalFat).toBeNull();
    });
  });

  describe("parent-field evidence", () => {
    it("resolves a glued form the parent field makes impossible", () => {
      // 19 g of saturated fat cannot fit in 11 g of total fat.
      expect(
        parseNutritionFromOCR("Total Fat 11 g\nSaturated 19").saturatedFat,
      ).toBe(1);
      // Same relation, other pairs: trans/total fat and sugars/carbohydrate.
      expect(parseNutritionFromOCR("Total Fat 11 g\n+ Trans 19").transFat).toBe(
        1,
      );
      expect(
        parseNutritionFromOCR("Carbohydrate 5 g\nSugars 19").totalSugars,
      ).toBe(1);
    });

    it("does not bound fibre by carbohydrate — the regimes disagree", () => {
      // "Carbohydrate" is not one quantity across labelling regimes: EU
      // 1169/2011 declares AVAILABLE carbohydrate and lists fibre separately
      // outside it, while US labels count fibre within total carbohydrate. OFF
      // carries both, so on an EU bran or psyllium product a CORRECT fibre
      // reading legitimately exceeds a correct carbohydrate one. Containment
      // would "resolve" that 19 to 1 and discard a right answer.
      expect(
        parseNutritionFromOCR("Carbohydrate 11 g\nFiber 19").dietaryFiber,
      ).toBeNull();
      // The sibling bound is sound and must stay: sugars sit inside the
      // available-carbohydrate fraction under US, EU and Codex alike.
      expect(
        parseNutritionFromOCR("Carbohydrate 11 g\nSugars 19").totalSugars,
      ).toBe(1);
    });

    it("declines when the whole-token reading still fits the parent", () => {
      // 19 g of saturated fat inside 25 g of total fat is entirely possible,
      // so both readings survive and neither may be picked.
      expect(
        parseNutritionFromOCR("Total Fat 25 g\nSaturated 19").saturatedFat,
      ).toBeNull();
    });

    it("declines a parent whose own unit was substituted", () => {
      // "Total Fat 129 9%" — the "9" taken as the unit is a daily value that
      // lost its "%", so totalFat reads 129 when the package says something
      // like 12.9. That parent is present and looks ordinary, and containment
      // used to accept it: 259 > 129 and 25 <= 129, so "Saturated 259" was
      // forced to 25. A bound is worth no more than the unit that produced it,
      // and two ambiguous readings do not add up to one certain one.
      const r = parseNutritionFromOCR("Total Fat 129 9%\nSaturated 259");
      expect(r.saturatedFat).toBeNull();
      // The corrupt parent itself is unchanged by this rule — it is a direct
      // read and predates the glued branch. Asserted so the decline above is
      // clearly about the CHILD being refused, not about the parent vanishing.
      expect(r.totalFat).toBe(129);
    });

    it("still allows a parent read with a real unit to bound a child", () => {
      // Negative control for the rule above: the refusal is scoped to parents
      // whose unit was substituted, not to containment generally.
      expect(
        parseNutritionFromOCR("Total Fat 11 g\nSaturated 19").saturatedFat,
      ).toBe(1);
      // And the spaced substitution is refused as a bound even when the value
      // it produced happens to be right.
      expect(
        parseNutritionFromOCR("Total Fat 11 9\nSaturated 19").saturatedFat,
      ).toBeNull();
    });

    it("declines when there is no parent value to test against", () => {
      // The parent did not parse, so the impossibility argument cannot be made.
      expect(parseNutritionFromOCR("Saturated 19").saturatedFat).toBeNull();
      // totalFat has no parent at all — this is the sauce label's "2.59".
      expect(parseNutritionFromOCR("Total Fat 19").totalFat).toBeNull();
    });
  });

  describe("guards the glued branch must not break", () => {
    it("never steals a value from a real g that follows it", () => {
      // THE regression that matters: "19 g" is nineteen grams. The glued
      // branch must refuse while a real unit is still sitting unconsumed,
      // even when the parent field would otherwise make 19 impossible.
      expect(
        parseNutritionFromOCR("Total Fat 11 g\nSaturated 19 g").saturatedFat,
      ).toBe(19);
      expect(
        parseNutritionFromOCR("Total Fat 11 g\nSaturated 19g").saturatedFat,
      ).toBe(19);
    });

    it("never steals a value from a lone 9 unit further along the line", () => {
      // "39 9" is thirty-nine grams — the lone "9" is the unit. The glued
      // branch reaches a match at capture "3", a SHORTER capture than the
      // lone-token branch needs, so ordering alone does not hold it back.
      expect(parseNutritionFromOCR("Total Sugars 39 9").totalSugars).toBe(39);
      // The same input with a parent present, which is where an early glued
      // win gets dangerous rather than merely lossy: it would capture 3, and
      // containment would then have to rule on it. 45 g of carbohydrate is
      // chosen so the label is physically coherent — 39 g of sugars fits
      // inside it — and the assertion still discriminates, because the buggy
      // reading yields null here (3 is adopted only if 39 OVERFLOWS the
      // parent, which it does not). With a SMALLER parent the same bug
      // produces a confidently wrong 3 instead of a null, which is the worse
      // outcome; it is not asserted here because pinning it would mean
      // writing down a label that cannot exist as expected input.
      expect(
        parseNutritionFromOCR("Carbohydrate 45 g\nSugars 39 9").totalSugars,
      ).toBe(39);
    });

    it("does not read a %DV that lost its percent sign", () => {
      // "195" is not "19" plus a unit — more digits follow the 9.
      expect(
        parseNutritionFromOCR("Total Fat 11 g\nSaturated 195").saturatedFat,
      ).toBeNull();
    });

    it("does not take its unit from the next line", () => {
      // The glued branch requires the "9" to be touching the value, so it
      // cannot reach a stray "9" shed by the %DV column below.
      expect(
        parseNutritionFromOCR("Total Fat 11 g\nSaturated 1\n9").saturatedFat,
      ).toBeNull();
    });
  });
});

describe("serving size — a serving spec ends at its last unit token", () => {
  it("drops an adjacent column merged onto the serving line", () => {
    expect(
      parseNutritionFromOCR("Per 1 tbsp (15 mL) Sugar, Vinegar, Splu Lguit")
        .servingSize,
    ).toBe("1 tbsp (15 mL)");
  });

  it("keeps a bilingual serving whole", () => {
    // Both halves are unit-bearing, so the trim must land after the LAST one.
    expect(
      parseNutritionFromOCR("Per 1 tbsp (15 mL)/par 1 c. à s. (15 mL)")
        .servingSize,
    ).toBe("1 tbsp (15 mL)/par 1 c. à s. (15 mL)");
  });

  it("leaves a clean serving line untouched", () => {
    expect(parseNutritionFromOCR("Per 30 ml (30 g)").servingSize).toBe(
      "30 ml (30 g)",
    );
    expect(parseNutritionFromOCR("Per 355 mL").servingSize).toBe("355 mL");
  });

  it("does not cut at a 'g' inside a word", () => {
    // "Sugar" and "Lguit" both contain a g. Only a g at a token boundary ends
    // the spec — otherwise the trim would cut mid-word and lose the unit.
    expect(parseNutritionFromOCR("Per 250 g Sugar").servingSize).toBe("250 g");
  });
});

/**
 * The `g` -> `9` substitution is the single largest cause of dropped fields,
 * but a `9` is also a digit, so tolerating it risks reading a real value wrong.
 * `totalFat`, `totalSugars` and `saturatedFat` go into the `labelNutrition`
 * payload and reach the user's log, so these are the assertions that matter
 * most in this file: the parser must recover the unambiguous form and DECLINE
 * the rest, never pick the likelier reading.
 */
describe("g→9 unit substitution — recover the lone token, decline the glued", () => {
  it("never reads a real two-digit value as its first digit", () => {
    // The regression that a careless fix causes: lazy `(\S+?)` would happily
    // capture "1" and treat the "9" of "19" as the unit. Requiring the
    // substituted unit to be whitespace-preceded forces the backtrack to the
    // real "g". If this fails, every 19/29/39g label is silently wrong.
    expect(parseNutritionFromOCR("Total Fat 19 g").totalFat).toBe(19);
    expect(parseNutritionFromOCR("Total Sugars 39g").totalSugars).toBe(39);
    expect(parseNutritionFromOCR("Protein 9 g").protein).toBe(9);
  });

  it("accepts a lone 9 in the unit slot", () => {
    expect(parseNutritionFromOCR("Total Fat 0 9").totalFat).toBe(0);
    expect(parseNutritionFromOCR("Total Sugars 39 9").totalSugars).toBe(39);
    expect(parseNutritionFromOCR("Protein 0.2 9").protein).toBe(0.2);
  });

  it("declines a 9 glued to the value", () => {
    // "19" is either 19 grams or "1 g" and the flattened text cannot say which.
    expect(parseNutritionFromOCR("Total Fat 19").totalFat).toBeNull();
    expect(parseNutritionFromOCR("Total Fat 2.59").totalFat).toBeNull();
    // "Total Carbohydrate 09" was declined alongside these two until the
    // leading-zero rule settled it. It now reads 0 — see the glued-g→9
    // describe block, which owns that rule and both sides of its boundary.
  });

  it("does not let a 9 on the next line supply this line's unit", () => {
    // `\s` matches newlines; `[ \t]` does not. MLKit's column merging makes a
    // stray digit on an adjacent line a live hazard, not a hypothetical one.
    expect(parseNutritionFromOCR("Total Fat 3\n9").totalFat).toBeNull();
  });

  it("does not read a %DV that lost its percent sign as a unit", () => {
    // "Total Fat 3 g 95%" degrading to "Total Fat 3 95" must not yield 3 —
    // the trailing digits mean this is not a bare unit glyph.
    expect(parseNutritionFromOCR("Total Fat 3 95").totalFat).toBeNull();
  });

  it("leaves mg fields alone — no m→9 substitution has been observed", () => {
    expect(parseNutritionFromOCR("Sodium 400 9").sodium).toBeNull();
  });

  it("declines when a real g is still sitting unconsumed after the 9", () => {
    // The shape the first version of this fix got wrong, and the reason the
    // `(?![ \t]*g)` guard exists. The "9" branch used to fire even with the
    // true unit right there, silently truncating the value:
    //
    //   "Total Fat 1 9 g" -> 1     (should be: decline)
    //
    // A dropped decimal point is a SINGLE OCR error producing exactly this
    // shape — "1.9 g" reads as "1 9 g" — and totalFat/saturatedFat/totalSugars
    // go into the labelNutrition payload, where a wrong value reaches
    // buildLabelConflict and replaces the database macros wholesale.
    expect(parseNutritionFromOCR("Total Fat 1 9 g").totalFat).toBeNull();
    expect(parseNutritionFromOCR("Total Fat 3 9g").totalFat).toBeNull();
    expect(
      parseNutritionFromOCR("Saturated Fat 0 9g 5%").saturatedFat,
    ).toBeNull();
    expect(parseNutritionFromOCR("Total Sugars 2 9 g").totalSugars).toBeNull();
  });
});

describe("marketing claims must not supply nutrition values", () => {
  // Front-of-pack claims sit in the same OCR blob as the panel on these
  // captures. None of them carries a number, so the guard that matters is that
  // they never become the FIRST match for a field whose real value is elsewhere.
  it("ignores 'NO TRANSFAT' / 'SANS GRASTRANS' badges", () => {
    const r = parseNutritionFromOCR(
      "NO TRANSFAT\nSANS GRASTRANS\nCalories 100\n+Trans / trans 0 g",
    );
    expect(r.transFat).toBe(0);
  });

  it("ignores a 'TRANS FAT FREE' claim rather than reading FREE as a number", () => {
    const r = parseNutritionFromOCR("TRANS FAT FREE\nCalories 100");
    expect(r.transFat).toBeNull();
  });

  it("ignores a 'LOW IN CHOLESTEROL' claim with no value", () => {
    const r = parseNutritionFromOCR("LOW IN CHOLESTEROL\nCalories 100");
    expect(r.cholesterol).toBeNull();
  });

  // The three cases above pair a claim with a VALUE-FREE next line, so on their
  // own they prove only that a claim with no adjacent number is ignored. These
  // pair a claim with a real number on the following line — the shape that
  // actually occurs, since OCR flattens the whole package into one blob and a
  // badge frequently sits directly above a panel line.
  it("does not take its value from the line below a claim", () => {
    expect(parseNutritionFromOCR("LOW SODIUM\n30 mg").sodium).toBeNull();
    expect(
      parseNutritionFromOCR("LOW IN CHOLESTEROL\n5 mg").cholesterol,
    ).toBeNull();
  });
});

/**
 * A field name, its value and its unit must all be on ONE line.
 *
 * Both `\s+` (before the value) and `\s*` (before the unit) match newlines, and
 * `g` matches the leading letter of any word — so a field could assemble itself
 * from three different lines. `Trans\n15\nGLUTEN FREE` read transFat = 15,
 * taking the value from line 2 and the "unit" from the G of GLUTEN.
 *
 * Every ingredient of that is present in the real captures: both carry
 * `GLUTEN FREE` / `SANS GLUTEN` badges and bare number-only lines (`15`, `19`,
 * `49`) shed by the %DV column. This was latent before the bilingual patterns
 * were extended and is not specific to them, but extending them widened it.
 */
describe("fields must not assemble themselves across lines", () => {
  it("does not take a value from the following line", () => {
    expect(parseNutritionFromOCR("Trans\n15\nGLUTEN FREE").transFat).toBeNull();
    expect(
      parseNutritionFromOCR("Fibres\n15\nGLUTEN FREE").dietaryFiber,
    ).toBeNull();
    expect(
      parseNutritionFromOCR("Sugars\n38\nGLUTEN FREE").totalSugars,
    ).toBeNull();
  });

  it("does not accept a word's leading letter as the gram unit", () => {
    expect(
      parseNutritionFromOCR("Total Fat 0\nGLUTEN FREE").totalFat,
    ).toBeNull();
    expect(parseNutritionFromOCR("Total Fat 5 Gras").totalFat).toBeNull();
  });

  it("still reads every legitimate same-line form", () => {
    // The guard must not cost recall on real labels.
    expect(parseNutritionFromOCR("Total Fat 12g").totalFat).toBe(12);
    expect(parseNutritionFromOCR("Fat / Lipides 0 g").totalFat).toBe(0);
    expect(parseNutritionFromOCR("Sodium 400 mg").sodium).toBe(400);
    expect(parseNutritionFromOCR("Total Fat 8g 10%").totalFat).toBe(8);
    expect(parseNutritionFromOCR("Dietary Fiber <1g").dietaryFiber).toBe(1);
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
   * splits `Carbohydrate` across two lines. Only 2 of 10 numeric field patterns
   * survive that — but the two fields this product decision cares about,
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
    // ...and almost nothing else did. `Fat / Ipldes 0 9` is now readable (the
    // "9" is a lone token), and 0 g of fat in a soda is correct. `Sugars Sucres
    // 39 9` is still lost, but for an unrelated reason: the recogniser dropped
    // the "/" separator, so no bilingual alternation matches the name at all.
    expect(parsed.totalFat).toBe(0);
    expect(parsed.totalSugars).toBeNull();

    // When this capture was taken the gate required (totalSugars ?? totalFat),
    // so this label was discarded and the screen fell back to the database's
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

  it("does not require sugars or fat, even when neither was read", () => {
    // The rule (user decision 2026-07-30): calories + a parseable serving are
    // the whole gate. Sugars and fat are NOT corroboration — they share failure
    // modes with each other and with everything else the recogniser mangles, so
    // demanding "either one" discards labels whose two source-of-truth fields
    // are perfect.
    //
    // The Cherry Coke capture above used to BE this proof — sugars and fat both
    // null from one glitch. The `g`->`9` fix recovered its fat, so it can no
    // longer exercise the both-absent case: under the old gate it would now
    // pass for the wrong reason, and this guard would quietly stop guarding.
    //
    // So the fixture is rebuilt to keep the property that mattered. It is
    // synthetic but NOT trivial — both fields are present in the text and both
    // are lost, each to a defect this file documents elsewhere: fat to an
    // ambiguous glued `g`->`9`, sugars to a dropped "/" separator, which is
    // what actually costs Cherry Coke its sugars. A fixture that simply
    // omitted the two lines would prove only that absent fields are absent.
    //
    // Rebuilt a SECOND time, same cause: the fat line was "Ipldes 09" until
    // the leading-zero rule made "09" readable. "19" is the glued form that
    // still declines — totalFat has no parent field to contradict it — so the
    // both-absent property survives. Whenever a fix here turns one of these
    // lines green, this fixture needs another still-broken input, not a
    // relaxed assertion: it is guarding the gate, not the parser.
    const parsed = parseNutritionFromOCR(
      "Nutrition Facts\nPer 1 can (355 mL)\nCalories 140\nFat / Ipldes 19\nSugars Sucres 39 9",
    );

    expect(parsed.totalSugars).toBeNull();
    expect(parsed.totalFat).toBeNull();
    expect(parsed.calories).toBe(140);
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
