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

describe("recipe-normalization properties", () => {
  describe("R1: idempotence", () => {
    it("normalizeTitle", () => {
      fc.assert(
        fc.property(arbText, (s) => {
          expect(normalizeTitle(normalizeTitle(s))).toBe(normalizeTitle(s));
        }),
        FC_PARAMS,
      );
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
      fc.assert(
        fc.property(arbMaybeText, (s) => {
          expect(normalizeDifficulty(normalizeDifficulty(s))).toBe(
            normalizeDifficulty(s),
          );
        }),
        FC_PARAMS,
      );
    });
    it("normalizeInstructions", () => {
      fc.assert(
        fc.property(
          fc.option(fc.array(arbText, { maxLength: 8 }), { nil: null }),
          (xs) => {
            expect(normalizeInstructions(normalizeInstructions(xs))).toEqual(
              normalizeInstructions(xs),
            );
          },
        ),
        FC_PARAMS,
      );
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
      fc.assert(
        fc.property(arbIngredient, (ing) => {
          const once = normalizeIngredient(ing);
          expect(normalizeIngredient(once)).toEqual(once);
        }),
        FC_PARAMS,
      );
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
