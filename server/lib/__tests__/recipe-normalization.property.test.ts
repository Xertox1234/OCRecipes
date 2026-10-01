// server/lib/__tests__/recipe-normalization.property.test.ts
/**
 * Property-based tests for server/lib/recipe-normalization.ts (fast-check).
 *
 * RELATIONS
 *   R1 idempotence  f(f(x)) deep-equals f(x) for all seven exports — a
 *                   normaliser that keeps changing its own output is not one.
 *   R2 quantity     for an integer quantity string with a non-blank unit,
 *                   Number(normalizeIngredient(ing).quantity) === Number(ing.quantity)
 *                   (the unit-extraction branch is skipped by keeping unit non-blank).
 *   R3 robustness   normalizeRecipeFields never throws over arbitrary strings
 *                   and arrays — the fuzz-shaped coverage that replaces a fuzzer.
 *
 * REGIME
 *   Under the pinned seed, 100 uniform draws never reach four of R1's branches
 *   (measured: 0/100 each) — a lowercase joining word in a title, a difficulty
 *   synonym, a numbered instruction, and a measurement inside an ingredient
 *   name. Each runs as fast-check `examples`, together with the four inputs
 *   that were not idempotent before the fix in the same branch ("ß" and "ﬁ"
 *   title starts, a doubled step prefix, a measurement name with leading
 *   whitespace). After each fc.assert, the relation asserts it saw its regime.
 *
 * Seed pinning per repo convention; not in any Stryker testInclude.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  normalizeDescription,
  normalizeDifficulty,
  normalizeIngredient,
  normalizeInstructions,
  normalizeRecipeFields,
  normalizeTitle,
  normalizeUnit,
  type IngredientInput,
  type RecipeFieldsInput,
} from "../recipe-normalization";

const FC_PARAMS = { seed: 20260914, numRuns: 100 } as const;

// Unicode-inclusive strings: the normalisers see real user input.
const arbText = fc.string({ maxLength: 60, unit: "grapheme" });
const arbMaybeText = fc.option(arbText, { nil: null });
const arbUnit = fc.constantFrom(
  "cup",
  "cups",
  "g",
  "kg",
  "ml",
  "tbsp",
  "TSP",
  " oz ",
  "pinch",
  "",
);
const arbIngredient: fc.Arbitrary<IngredientInput> = fc.record({
  name: arbText,
  quantity: fc.oneof(
    fc.integer({ min: 0, max: 999 }).map(String),
    fc.constantFrom("1/2", "1 1/2", "0.25", "", "  3 "),
    arbText,
  ),
  unit: arbUnit,
});
const arbFields: fc.Arbitrary<RecipeFieldsInput> = fc.record(
  {
    title: arbText,
    description: arbMaybeText,
    difficulty: arbMaybeText,
    instructions: fc.option(fc.array(arbText, { maxLength: 8 }), { nil: null }),
    ingredients: fc.option(
      fc.array(
        fc.record({
          name: arbText,
          quantity: fc.option(arbText, { nil: null }),
          unit: fc.option(arbUnit, { nil: null }),
        }),
        { maxLength: 6 },
      ),
      { nil: null },
    ),
  },
  { requiredKeys: [] },
);

const TITLE_EXAMPLES: [string][] = [
  ["toast with butter and jam"],
  ["ßauce of the day"],
  ["ﬁsh and chips"],
];
const DIFFICULTY_EXAMPLES: [string][] = [["Moderate"], [" expert "]];
const INSTRUCTION_EXAMPLES: [string[]][] = [
  [["1. 2. whisk the eggs", "Step 3: fold in the flour"]],
];
// Hoisted: the seed guard's paren matcher cannot see inside a regex literal
// (its documented limitation), and this one has unmatched ")" characters.
const DOUBLE_STEP_PREFIX_RE = /^\s*\d+[.)]\s*\d+[.)]/;
const INGREDIENT_EXAMPLES: [IngredientInput][] = [
  [{ name: "3 tbsp sugar", quantity: "", unit: "" }],
  [{ name: " 2 cups flour", quantity: "", unit: "" }],
];

describe("recipe-normalization properties", () => {
  describe("R1: idempotence", () => {
    it("normalizeTitle", () => {
      let keptJoiningWord = 0;
      let multiCharUpperStart = 0;
      fc.assert(
        fc.property(arbText, (s) => {
          const once = normalizeTitle(s);
          expect(normalizeTitle(once)).toBe(once);
          if (
            once
              .split(" ")
              .slice(1)
              .some((w) => /^[a-z]+$/.test(w))
          ) {
            keptJoiningWord++;
          }
          if (s.trim().toLowerCase().charAt(0).toUpperCase().length > 1) {
            multiCharUpperStart++;
          }
        }),
        { ...FC_PARAMS, examples: TITLE_EXAMPLES },
      );
      expect(keptJoiningWord).toBeGreaterThan(0);
      expect(multiCharUpperStart).toBeGreaterThan(0);
    });
    it("normalizeDescription", () => {
      fc.assert(
        fc.property(arbMaybeText, (s) => {
          expect(normalizeDescription(normalizeDescription(s))).toBe(
            normalizeDescription(s),
          );
        }),
        FC_PARAMS,
      );
    });
    it("normalizeDifficulty", () => {
      let mapped = 0;
      fc.assert(
        fc.property(arbMaybeText, (s) => {
          const once = normalizeDifficulty(s);
          expect(normalizeDifficulty(once)).toBe(once);
          if (once !== null) mapped++;
        }),
        { ...FC_PARAMS, examples: DIFFICULTY_EXAMPLES },
      );
      expect(mapped).toBeGreaterThan(0);
    });
    it("normalizeInstructions", () => {
      let doublePrefixed = 0;
      fc.assert(
        fc.property(
          fc.option(fc.array(arbText, { maxLength: 8 }), { nil: null }),
          (xs) => {
            const once = normalizeInstructions(xs);
            expect(normalizeInstructions(once)).toEqual(once);
            if (xs?.some((step) => DOUBLE_STEP_PREFIX_RE.test(step))) {
              doublePrefixed++;
            }
          },
        ),
        { ...FC_PARAMS, examples: INSTRUCTION_EXAMPLES },
      );
      expect(doublePrefixed).toBeGreaterThan(0);
    });
    it("normalizeUnit", () => {
      fc.assert(
        fc.property(fc.oneof(arbUnit, arbText), (u) => {
          expect(normalizeUnit(normalizeUnit(u))).toBe(normalizeUnit(u));
        }),
        FC_PARAMS,
      );
    });
    it("normalizeIngredient", () => {
      let extracted = 0;
      let extractedFromPaddedName = 0;
      fc.assert(
        fc.property(arbIngredient, (ing) => {
          const once = normalizeIngredient(ing);
          expect(normalizeIngredient(once)).toEqual(once);
          if (!ing.quantity.trim() && !ing.unit.trim() && once.unit !== "") {
            extracted++;
            if (ing.name !== ing.name.trimStart()) extractedFromPaddedName++;
          }
        }),
        { ...FC_PARAMS, examples: INGREDIENT_EXAMPLES },
      );
      expect(extracted).toBeGreaterThan(0);
      expect(extractedFromPaddedName).toBeGreaterThan(0);
    });
    it("normalizeRecipeFields", () => {
      fc.assert(
        fc.property(arbFields, (data) => {
          const once = normalizeRecipeFields(data);
          expect(normalizeRecipeFields(once)).toEqual(once);
        }),
        FC_PARAMS,
      );
    });
  });

  it("R2: an integer quantity keeps its numeric value", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 999 }),
        arbText,
        fc.constantFrom("cup", "g", "ml", "tbsp"),
        (n, name, unit) => {
          const out = normalizeIngredient({ name, quantity: String(n), unit });
          expect(Number(out.quantity)).toBe(n);
        },
      ),
      FC_PARAMS,
    );
  });

  it("R3: normalizeRecipeFields never throws on arbitrary input", () => {
    fc.assert(
      fc.property(arbFields, (data) => {
        expect(() => normalizeRecipeFields(data)).not.toThrow();
      }),
      FC_PARAMS,
    );
  });
});
