// client/lib/__tests__/serving-scale.property.test.ts
/**
 * Property-based tests for client/lib/serving-scale.ts (fast-check).
 *
 * RELATIONS
 *   R1 round-trip   |parseFraction(formatAsFraction(x)) - x| <= 0.05 + 0.003
 *                   for x in [0, 1000] — the shown amount is within the
 *                   1-decimal fallback (0.05) plus FRACTION_TOLERANCE.
 *   R2 stable       formatAsFraction(parseFraction(formatAsFraction(x))) ===
 *                   formatAsFraction(x) — an amount read back off the screen
 *                   shows the same text again (0.46 once showed "0.5", while
 *                   0.5 shows "1/2").
 *   R3 not-a-number parseFraction(s) === null for every string s that is not a
 *                   non-negative decimal, simple fraction or mixed fraction.
 *                   Drawn from an alphabet that makes Number()-accepted strings
 *                   common ("1e3", "0x10", "-1", "Infinity", "5."), so the
 *                   relation does not rest on the hand-listed examples alone.
 *   R4 finite       scaleIngredientQuantity never shows "-", "NaN" or
 *                   "Infinity": a negative, non-finite or overflowing amount
 *                   is reported non-numeric instead.
 *
 * Why properties here: a quantity string comes from recipe imports and AI
 * output, so the inputs are not the ones an author thinks of. Example tests in
 * serving-scale.test.ts pin the cases found by hand; these cover the class.
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
  formatAsFraction,
  parseFraction,
  scaleIngredientQuantity,
} from "../serving-scale";

const FC_PARAMS = { seed: 20261122, numRuns: 100 } as const;

// What parseFraction promises to accept — the oracle for R3.
const QUANTITY_RE = /^\s*(\d+(\.\d+)?|\.\d+|\d+\/\d+|\d+\s+\d+\/\d+)\s*$/;

const NUMERICISH_CHARS = [
  ..."0123456789",
  ".",
  "/",
  "-",
  "+",
  "e",
  "x",
  ..."Infinity",
  ",",
  " ",
];
const numericishArb = fc.string({
  unit: fc.constantFrom(...NUMERICISH_CHARS),
  minLength: 1,
  maxLength: 8,
});

const amountArb = fc.double({ min: 0, max: 1000, noNaN: true });

const BAD_TEXT = /-|NaN|Infinity/;

function showsOnlyAFiniteAmount(result: {
  scaled: string | null;
  isNumeric: boolean;
}): boolean {
  if (!result.isNumeric) return true;
  return result.scaled !== null && !BAD_TEXT.test(result.scaled);
}

describe("serving-scale properties", () => {
  it("R1: a formatted amount reads back within the display tolerance", () => {
    fc.assert(
      fc.property(amountArb, (x) => {
        const back = parseFraction(formatAsFraction(x));
        expect(back).not.toBeNull();
        expect(Math.abs(back! - x)).toBeLessThanOrEqual(0.05 + 0.003);
      }),
      FC_PARAMS,
    );
  });

  it("R2: a displayed amount, read back, shows the same text", () => {
    fc.assert(
      fc.property(amountArb, (x) => {
        const shown = formatAsFraction(x);
        expect(formatAsFraction(parseFraction(shown)!)).toBe(shown);
      }),
      { ...FC_PARAMS, examples: [[0.46], [1.46]] },
    );
  });

  it("R3: a string that is not a quantity parses to null", () => {
    fc.assert(
      fc.property(numericishArb, (s) => {
        fc.pre(!QUANTITY_RE.test(s));
        expect(parseFraction(s)).toBeNull();
      }),
      {
        ...FC_PARAMS,
        examples: [["Infinity"], ["1e3"], ["0x10"], ["-1"], ["5."]],
      },
    );
  });

  it("R4: a scaled number never shows a negative, NaN or Infinity", () => {
    fc.assert(
      fc.property(fc.double(), fc.double({ min: 0, max: 100 }), (n, r) => {
        expect(showsOnlyAFiniteAmount(scaleIngredientQuantity(n, r))).toBe(
          true,
        );
      }),
      { ...FC_PARAMS, examples: [[1e308, 2]] },
    );
  });

  it("R4: a scaled string never shows a negative, NaN or Infinity", () => {
    fc.assert(
      fc.property(numericishArb, fc.double({ min: 0, max: 100 }), (s, r) => {
        expect(showsOnlyAFiniteAmount(scaleIngredientQuantity(s, r))).toBe(
          true,
        );
      }),
      { ...FC_PARAMS, examples: [["9".repeat(400), 2]] },
    );
  });
});
