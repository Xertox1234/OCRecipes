// client/lib/__tests__/nutrition-ocr-parser.property.test.ts
/**
 * Property-based tests for parseNutritionFromOCR (fast-check).
 *
 * LAYER A — any input at all (token soup weighted toward the parser's own
 * vocabulary, plus arbitrary Unicode)
 *   A1 total        never throws; the same text parses to the same result twice.
 *   A2 range        every numeric field is null or a finite number in
 *                   [0, 10000] (the parser's MAX_NUTRITION_VALUE).
 *   A3 confidence   is one of 0, 0.1, … 1, and counts no more fields than came
 *                   back non-null.
 *   A4 directReads  has no duplicates, names only non-null fields, and is no
 *                   longer than the count `confidence` reports.
 *   A5 serving      servingSize is null or at most 100 characters.
 *
 * LAYER B — a known label, rendered cleanly (US or bilingual Canadian names,
 * glued or spaced unit, with or without a % Daily Value)
 *   B1 round-trip   the parse equals the label: all ten values, the serving
 *                   text, confidence 1, all ten fields in directReads.
 *   B2 noise        badge lines and bare number lines inserted anywhere in the
 *                   panel change nothing (one known gap: nameSpansTwoLines).
 *                   The lines are the ones the parser's comments record from
 *                   device captures ("GLUTEN FREE", "LOW SODIUM", "15", …).
 *
 * LAYER C — the same label with the recogniser's g -> 9 substitution applied
 *   C1 spaced       "12 9": the value is still the label's, but the field is
 *                   NOT in directReads. (One known drop: isDroppedSubFatNine.)
 *   C2 glued        "129": the field is null or the label's value, never
 *                   anything else, and NOT in directReads.
 *   C3 mixed        any mix of clean, spaced and glued units, with a % Daily
 *                   Value that may have lost its "%": every field in
 *                   directReads equals the label, and the fields rendered
 *                   without damage (calories, cholesterol, sodium) still do.
 *
 * C3 is deliberately weaker than "no wrong value". "Total Fat 129 9%" reads
 * totalFat = 129 where the package prints 12 — the parser documents this (the
 * `substitutedUnit` comment in parseNutritionFromOCR) and answers it by
 * keeping the field out of directReads, which is the list that may condemn a
 * database record. So directReads is where the promise is, and C2 leaves the
 * lone-"9" Daily Value out of its generator for the same reason.
 *
 * Why properties here: OCR text is noisy by construction, so the inputs that
 * hurt are not the ones an author writes down. The example suite in
 * nutrition-ocr-parser.test.ts pins the device captures; these cover the
 * classes those captures belong to.
 *
 * Seed pinning: vitest.config.mts sets retry: 2; an unseeded counterexample
 * could pass on a fresh seed and mask a real defect. Pinned per the repo
 * convention:
 * docs/solutions/conventions/fast-check-property-tests-pin-seed-not-in-mutation-testinclude-2026-07-12.md
 * Not in any Stryker testInclude.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  parseNutritionFromOCR,
  type LocalNutritionData,
  type NumericField,
} from "../nutrition-ocr-parser";

const FC_PARAMS = { seed: 20261123, numRuns: 100 } as const;

const NUMERIC_FIELDS = [
  "calories",
  "totalFat",
  "saturatedFat",
  "transFat",
  "cholesterol",
  "sodium",
  "totalCarbs",
  "dietaryFiber",
  "totalSugars",
  "protein",
] as const satisfies readonly NumericField[];

const GRAM_FIELDS = [
  "totalFat",
  "saturatedFat",
  "transFat",
  "totalCarbs",
  "dietaryFiber",
  "totalSugars",
  "protein",
] as const satisfies readonly NumericField[];
type GramField = (typeof GRAM_FIELDS)[number];

type Label = Record<NumericField, number>;

// ── Layer A generator ───────────────────────────────────────────────────────
// Uniform random characters almost never spell a field name, so the soup is
// built from the parser's own vocabulary: names in both languages, the unit
// glyphs, the digits the recogniser confuses with them, and the separators
// that decide whether a value stays on its line.
const SOUP_TOKENS = [
  "Calories",
  "Calories from",
  "Total Fat",
  "Fat",
  "Lipides",
  "Saturated Fat",
  "Saturated",
  "saturés",
  "Trans Fat",
  "Trans",
  "Cholesterol",
  "Cholestérol",
  "Sodium",
  "Total Carbohydrate",
  "Total Carb.",
  "Glucides",
  "Dietary Fiber",
  "Fibre",
  "Total Sugars",
  "Sugars",
  "Sucres",
  "Protein",
  "Protéines",
  "Serving Size",
  "Per",
  "GLUTEN FREE",
  ..."0123456789",
  "9",
  "9",
  "g",
  "g",
  "mg",
  "mL",
  "%",
  "<",
  "/",
  ".",
  "-",
  "+",
  "(",
  ")",
  "O",
  "l",
  "S",
  "e",
  "Infinity",
  " ",
  " ",
  " ",
  "\t",
  "\n",
  "\n",
];

const soupArb = fc
  .array(fc.constantFrom(...SOUP_TOKENS), { maxLength: 40 })
  .map((tokens) => tokens.join(""));

// The soup rarely lines a name, a value and a unit up in that order, so on its
// own it would leave A2-A4 checking mostly empty results. These lines are
// almost-panel lines: a real name, then a value and a unit that may each be
// wrong, missing or misread.
const NAME_TOKENS = SOUP_TOKENS.filter((token) =>
  /^[A-Z][a-zé .]+$/.test(token),
);
const VALUE_TOKENS = [
  "0",
  "5",
  "9",
  "12",
  "19",
  "09",
  "019",
  "0.5",
  "2.59",
  "129",
  "470",
  "99999",
  "<1",
  "l2",
  "O",
  "1S",
  "-5",
  "1e9",
  "Infinity",
  "",
];
const UNIT_TOKENS = ["g", " g", "9", " 9", "mg", " mg", "", " 9%", "g 15%"];
const looseLinesArb = fc
  .array(
    fc
      .tuple(
        fc.constantFrom(...NAME_TOKENS),
        fc.constantFrom(" ", " ", " / Lipides ", "\n", ""),
        fc.constantFrom(...VALUE_TOKENS),
        fc.constantFrom(...UNIT_TOKENS),
      )
      .map((parts) => parts.join("")),
    { maxLength: 12 },
  )
  .map((lines) => lines.join("\n"));

const anyTextArb = fc.oneof(
  { weight: 2, arbitrary: soupArb },
  { weight: 2, arbitrary: looseLinesArb },
  { weight: 1, arbitrary: fc.string({ unit: "grapheme", maxLength: 80 }) },
);

// Exact equality with `confidence` is safe only because the parser computes it
// by the same division (extracted / 10). If that changes, compare with a
// tolerance instead.
const CONFIDENCE_STEPS = Array.from({ length: 11 }, (_, n) => n / 10);

function nonNullFields(result: LocalNutritionData): NumericField[] {
  return NUMERIC_FIELDS.filter((key) => result[key] !== null);
}

// ── Layer B/C generators ────────────────────────────────────────────────────
// Values sit on the printed rounding grid (0.5 g steps below 5 g, whole grams
// from there), and a child never exceeds its parent — the containment the
// parser's PARENT_FIELD relies on when it resolves a glued unit.
const GRAM_GRID = [
  ...Array.from({ length: 10 }, (_, n) => n / 2),
  ...Array.from({ length: 56 }, (_, n) => n + 5),
];
const gramsArb = fc.constantFrom(...GRAM_GRID);

const labelArb: fc.Arbitrary<Label> = fc
  .record({
    calories: fc.integer({ min: 0, max: 900 }),
    totalFat: gramsArb,
    saturatedFat: gramsArb,
    transFat: gramsArb,
    cholesterol: fc.integer({ min: 0, max: 300 }),
    sodium: fc.integer({ min: 0, max: 2000 }),
    totalCarbs: gramsArb,
    dietaryFiber: gramsArb,
    totalSugars: gramsArb,
    protein: gramsArb,
  })
  .map((raw) => ({
    ...raw,
    saturatedFat: Math.min(raw.saturatedFat, raw.totalFat),
    transFat: Math.min(raw.transFat, raw.totalFat),
    totalSugars: Math.min(raw.totalSugars, raw.totalCarbs),
  }));

type NameStyle = "us" | "bilingual";

const FIELD_NAMES: Record<NameStyle, Record<NumericField, string>> = {
  us: {
    calories: "Calories",
    totalFat: "Total Fat",
    saturatedFat: "Saturated Fat",
    transFat: "Trans Fat",
    cholesterol: "Cholesterol",
    sodium: "Sodium",
    totalCarbs: "Total Carbohydrate",
    dietaryFiber: "Dietary Fiber",
    totalSugars: "Total Sugars",
    protein: "Protein",
  },
  bilingual: {
    calories: "Calories",
    totalFat: "Fat / Lipides",
    saturatedFat: "Saturated / saturés",
    // The recogniser renders the sub-line indent as a leading "+".
    transFat: "+ Trans / trans",
    cholesterol: "Cholesterol / Cholestérol",
    sodium: "Sodium",
    totalCarbs: "Carbohydrate / Glucides",
    dietaryFiber: "Fibre / Fibres",
    totalSugars: "Sugars / Sucres",
    protein: "Protein / Protéines",
  },
};

/** How the gram unit after a value was printed — or misread. */
type UnitForm = "glued" | "spaced" | "spaced9" | "glued9";
/** The % Daily Value column: absent, intact, or shorn of its "%". */
type DailyValueForm = "none" | "percent" | "bare";

interface FieldFormat {
  unit: UnitForm;
  dv: DailyValueForm;
  dvValue: number;
}

type GramFormats = Record<GramField, FieldFormat>;

function gramFormatsArb(
  units: readonly UnitForm[],
  dvs: readonly DailyValueForm[],
  dvValueArb: fc.Arbitrary<number> = fc.integer({ min: 0, max: 100 }),
): fc.Arbitrary<GramFormats> {
  const one = fc.record({
    unit: fc.constantFrom(...units),
    dv: fc.constantFrom(...dvs),
    dvValue: dvValueArb,
  });
  return fc.record(
    Object.fromEntries(GRAM_FIELDS.map((key) => [key, one])) as {
      [K in GramField]: fc.Arbitrary<FieldFormat>;
    },
  );
}

const CLEAN_UNITS = ["glued", "spaced"] as const;
const INTACT_DVS = ["none", "percent"] as const;
const ANY_DVS = ["none", "percent", "bare"] as const;

const cleanFormatsArb = gramFormatsArb(CLEAN_UNITS, INTACT_DVS);

interface Serving {
  quantity: number;
  amount: number;
}
const servingArb: fc.Arbitrary<Serving> = fc.record({
  quantity: fc.integer({ min: 1, max: 4 }),
  amount: fc.integer({ min: 1, max: 500 }),
});

function servingText(style: NameStyle, serving: Serving): string {
  return style === "us"
    ? `${serving.quantity} cup (${serving.amount}g)`
    : `${serving.quantity} can (${serving.amount} mL)`;
}

const UNIT_TEXT: Record<UnitForm, string> = {
  glued: "g",
  spaced: " g",
  spaced9: " 9",
  glued9: "9",
};

function dailyValueText(format: FieldFormat): string {
  if (format.dv === "none") return "";
  return format.dv === "percent" ? ` ${format.dvValue}%` : ` ${format.dvValue}`;
}

interface Panel {
  label: Label;
  style: NameStyle;
  serving: Serving;
  formats: GramFormats;
  mgSpaced: boolean;
}

function isGramField(key: NumericField): key is GramField {
  return (GRAM_FIELDS as readonly NumericField[]).includes(key);
}

function renderLines(panel: Panel): string[] {
  const { label, style, serving, formats, mgSpaced } = panel;
  const names = FIELD_NAMES[style];
  const servingLine =
    style === "us"
      ? `Serving Size ${servingText(style, serving)}`
      : `Per ${servingText(style, serving)}`;
  const lines = ["Nutrition Facts", servingLine];
  for (const key of NUMERIC_FIELDS) {
    if (key === "calories") {
      lines.push(`${names[key]} ${label[key]}`);
    } else if (isGramField(key)) {
      const format = formats[key];
      lines.push(
        `${names[key]} ${label[key]}${UNIT_TEXT[format.unit]}${dailyValueText(format)}`,
      );
    } else {
      lines.push(`${names[key]} ${label[key]}${mgSpaced ? " mg" : "mg"}`);
    }
  }
  return lines;
}

function panelArb(formatsArb: fc.Arbitrary<GramFormats>): fc.Arbitrary<Panel> {
  return fc.record({
    label: labelArb,
    style: fc.constantFrom<NameStyle>("us", "bilingual"),
    serving: servingArb,
    formats: formatsArb,
    mgSpaced: fc.boolean(),
  });
}

function numbersOf(result: LocalNutritionData): Record<string, number | null> {
  return Object.fromEntries(NUMERIC_FIELDS.map((key) => [key, result[key]]));
}

// Text the recogniser picks up from the rest of the package and flattens into
// the same string as the panel. Each one is named in the parser's comments as
// a line that once supplied a field with a value or a unit it did not own.
const NOISE_LINES = [
  "GLUTEN FREE",
  "SANS GLUTEN",
  "NO TRANSFAT",
  "SANS GRASTRANS",
  "LOW SODIUM",
  "REDUCED CALORIES",
  "Amount per serving",
  "% Daily Value*",
  "15",
  "19",
  "49",
];

const noiseArb = fc.array(
  fc.record({ at: fc.nat(), line: fc.constantFrom(...NOISE_LINES) }),
  { minLength: 1, maxLength: 8 },
);

function withNoise(
  lines: readonly string[],
  noise: readonly { at: number; line: string }[],
): string[] {
  const out = [...lines];
  for (const { at, line } of noise) {
    out.splice(at % (out.length + 1), 0, line);
  }
  return out;
}

// KNOWN DEFECT (found by B2, 2026-11-23; not fixed here). The two-word names
// are matched with `\s+` between the words, which crosses a newline, so a line
// ENDING in "trans" or "saturated" directly above a bare "Fat …" line spells
// the name across the two: "SANS GRASTRANS\nFat / Lipides 44g" reads
// transFat = 44 as a direct read. B2 leaves that adjacency out of its noise
// until the parser holds a name to one line; drop this guard when it does.
function nameSpansTwoLines(lines: readonly string[]): boolean {
  return lines.some(
    (line, i) =>
      /(?:trans|saturated)$/i.test(line) && /^fat\b/i.test(lines[i + 1] ?? ""),
  );
}

// KNOWN DEFECT (found by C1, 2026-11-23; not fixed here — see
// todos/P3-2026-11-23-nutrition-ocr-us-sub-fat-nine-dropped.md). On a US panel
// "Saturated Fat 9 9" and "Trans Fat 9 9" parse to null: the bare-name branch
// starts one character earlier (at the newline), takes the word "Fat" as the
// value and the first "9" as its unit. The field is lost, not misread, so C1
// lets exactly this case come back null and still rejects any other value.
function isDroppedSubFatNine(panel: Panel, key: NumericField): boolean {
  return (
    panel.style === "us" &&
    (key === "saturatedFat" || key === "transFat") &&
    panel.label[key] === 9
  );
}

describe("parseNutritionFromOCR properties", () => {
  describe("layer A: any input", () => {
    it("A1: never throws and parses the same text the same way twice", () => {
      fc.assert(
        fc.property(anyTextArb, (text) => {
          expect(parseNutritionFromOCR(text)).toEqual(
            parseNutritionFromOCR(text),
          );
        }),
        FC_PARAMS,
      );
    });

    it("A2: every numeric field is null or within [0, 10000]", () => {
      fc.assert(
        fc.property(anyTextArb, (text) => {
          const result = parseNutritionFromOCR(text);
          for (const key of NUMERIC_FIELDS) {
            const value = result[key];
            if (value === null) continue;
            expect(Number.isFinite(value)).toBe(true);
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThanOrEqual(10000);
          }
        }),
        {
          ...FC_PARAMS,
          examples: [
            ["Calories Infinity"],
            ["Calories 1e9"],
            ["Sodium -5mg"],
            ["Total Fat 99999g"],
          ],
        },
      );
    });

    it("A3: confidence is a tenth-step that counts no more than the non-null fields", () => {
      fc.assert(
        fc.property(anyTextArb, (text) => {
          const result = parseNutritionFromOCR(text);
          const counted = CONFIDENCE_STEPS.indexOf(result.confidence);
          expect(counted).toBeGreaterThanOrEqual(0);
          expect(counted).toBeLessThanOrEqual(nonNullFields(result).length);
        }),
        FC_PARAMS,
      );
    });

    it("A4: directReads is a duplicate-free subset of the fields confidence counted", () => {
      fc.assert(
        fc.property(anyTextArb, (text) => {
          const result = parseNutritionFromOCR(text);
          const { directReads } = result;
          expect(new Set(directReads).size).toBe(directReads.length);
          expect(nonNullFields(result)).toEqual(
            expect.arrayContaining(directReads),
          );
          expect(directReads.length).toBeLessThanOrEqual(
            CONFIDENCE_STEPS.indexOf(result.confidence),
          );
        }),
        {
          ...FC_PARAMS,
          examples: [
            ["Total Fat 11g\nSaturated Fat 19"],
            ["Total Fat 129 9%\nSaturated Fat 259"],
          ],
        },
      );
    });

    it("A5: servingSize is null or at most 100 characters", () => {
      fc.assert(
        fc.property(anyTextArb, (text) => {
          const { servingSize } = parseNutritionFromOCR(text);
          if (servingSize !== null) {
            expect(servingSize.length).toBeLessThanOrEqual(100);
          }
        }),
        {
          ...FC_PARAMS,
          examples: [[`Serving Size ${"1 cup ".repeat(40)}`]],
        },
      );
    });
  });

  describe("layer B: a clean label", () => {
    it("B1: a rendered label parses back to itself, every field a direct read", () => {
      fc.assert(
        fc.property(panelArb(cleanFormatsArb), (panel) => {
          const result = parseNutritionFromOCR(renderLines(panel).join("\n"));
          expect(numbersOf(result)).toEqual(panel.label);
          expect(result.servingSize).toBe(
            servingText(panel.style, panel.serving),
          );
          expect(result.confidence).toBe(1);
          expect([...result.directReads].sort()).toEqual(
            [...NUMERIC_FIELDS].sort(),
          );
        }),
        FC_PARAMS,
      );
    });

    it("B2: badge and bare-number lines anywhere in the panel change nothing", () => {
      fc.assert(
        fc.property(panelArb(cleanFormatsArb), noiseArb, (panel, noise) => {
          const lines = renderLines(panel);
          const noisy = withNoise(lines, noise);
          fc.pre(!nameSpansTwoLines(noisy));
          expect(parseNutritionFromOCR(noisy.join("\n"))).toEqual(
            parseNutritionFromOCR(lines.join("\n")),
          );
        }),
        FC_PARAMS,
      );
    });
  });

  describe("layer C: the g -> 9 substitution", () => {
    it("C1: a spaced substituted unit keeps the value but is not a direct read", () => {
      fc.assert(
        fc.property(panelArb(gramFormatsArb(["spaced9"], ANY_DVS)), (panel) => {
          const result = parseNutritionFromOCR(renderLines(panel).join("\n"));
          for (const key of NUMERIC_FIELDS) {
            if (result[key] === null && isDroppedSubFatNine(panel, key)) {
              continue;
            }
            expect(result[key]).toBe(panel.label[key]);
          }
          for (const key of GRAM_FIELDS) {
            expect(result.directReads).not.toContain(key);
          }
        }),
        FC_PARAMS,
      );
    });

    // C2 passes if the parser declines every glued form. That it also RESOLVES
    // the forced ones ("Glucides 09" -> 0, "saturés 19" under 11 g of fat -> 1)
    // is pinned by the "glued g→9" examples in nutrition-ocr-parser.test.ts.
    it("C2: a glued substituted unit is declined or resolved to the label's value", () => {
      fc.assert(
        fc.property(
          panelArb(
            gramFormatsArb(
              ["glued9"],
              ANY_DVS,
              // A lone "9" in the Daily Value column is the documented
              // "Total Fat 129 9%" -> 129 limit; C3 covers it.
              fc.integer({ min: 0, max: 100 }).filter((n) => n !== 9),
            ),
          ),
          (panel) => {
            const result = parseNutritionFromOCR(renderLines(panel).join("\n"));
            for (const key of GRAM_FIELDS) {
              if (result[key] !== null) {
                expect(result[key]).toBe(panel.label[key]);
              }
              expect(result.directReads).not.toContain(key);
            }
          },
        ),
        FC_PARAMS,
      );
    });

    it("C3: under any mix of damage, every direct read equals the label", () => {
      fc.assert(
        fc.property(
          panelArb(
            gramFormatsArb(["glued", "spaced", "spaced9", "glued9"], ANY_DVS),
          ),
          (panel) => {
            const result = parseNutritionFromOCR(renderLines(panel).join("\n"));
            for (const key of result.directReads) {
              expect(result[key]).toBe(panel.label[key]);
            }
            for (const key of ["calories", "cholesterol", "sodium"] as const) {
              expect(result[key]).toBe(panel.label[key]);
              expect(result.directReads).toContain(key);
            }
            for (const key of GRAM_FIELDS) {
              const damaged = panel.formats[key].unit.endsWith("9");
              expect(result.directReads.includes(key)).toBe(!damaged);
            }
          },
        ),
        FC_PARAMS,
      );
    });
  });
});
