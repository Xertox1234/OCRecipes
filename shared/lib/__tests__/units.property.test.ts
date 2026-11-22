// shared/lib/__tests__/units.property.test.ts
/**
 * Property-based tests for shared/lib/units.ts (fast-check).
 *
 * RELATIONS
 *   R1 round-trip  lbsToKg(kgToLbs(x)) ≈ x and inchesToCm(cmToInches(x)) ≈ x,
 *                  within 1e-9 × max(1, |x|) — the bound still means something
 *                  at x = 0, where a purely relative bound would not.
 *   R2 unit trip   weightToKg(weightFromKg(x, u), u) ≈ x and
 *                  heightToCm(heightFromCm(x, u), u) ≈ x for both units —
 *                  a stored value shown and saved back in either unit is the
 *                  value that was stored.
 *   R3 monotone    a ≤ b ⇒ kgToLbs(a) ≤ kgToLbs(b), and the same for
 *                  cmToInches. `≤`, not `<`: cmToInches multiplies by less
 *                  than 1, and two subnormal inputs can map to one output.
 *
 * Why properties here: the pairs of constants (LBS_PER_KG / KG_PER_LB,
 * INCHES_PER_CM / CM_PER_INCH) are written out by hand and must stay inverse
 * to each other; a typo in one drifts a user's weight every time they save it
 * in imperial. R1 was checked against a deliberately wrong LBS_PER_KG (2.2)
 * and failed, so it can catch that drift.
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
  cmToInches,
  heightFromCm,
  heightToCm,
  inchesToCm,
  kgToLbs,
  lbsToKg,
  weightFromKg,
  weightToKg,
  type MeasurementUnit,
} from "../units";

const FC_PARAMS = { seed: 20261122, numRuns: 100 } as const;

const valueArb = fc.double({ min: 0, max: 1e4, noNaN: true });
const unitArb = fc.constantFrom<MeasurementUnit>("metric", "imperial");

function expectClose(actual: number, x: number): void {
  expect(Math.abs(actual - x)).toBeLessThanOrEqual(
    1e-9 * Math.max(1, Math.abs(x)),
  );
}

describe("units properties", () => {
  it("R1: kg↔lbs and cm↔inches round-trip", () => {
    fc.assert(
      fc.property(valueArb, (x) => {
        expectClose(lbsToKg(kgToLbs(x)), x);
        expectClose(inchesToCm(cmToInches(x)), x);
      }),
      FC_PARAMS,
    );
  });

  it("R2: a stored value shown and saved back in either unit is unchanged", () => {
    fc.assert(
      fc.property(valueArb, unitArb, (x, u) => {
        expectClose(weightToKg(weightFromKg(x, u), u), x);
        expectClose(heightToCm(heightFromCm(x, u), u), x);
      }),
      FC_PARAMS,
    );
  });

  it("R3: conversions never reverse the order of two values", () => {
    fc.assert(
      fc.property(valueArb, valueArb, (p, q) => {
        const [a, b] = p <= q ? [p, q] : [q, p];
        expect(kgToLbs(a)).toBeLessThanOrEqual(kgToLbs(b));
        expect(cmToInches(a)).toBeLessThanOrEqual(cmToInches(b));
      }),
      FC_PARAMS,
    );
  });
});
