import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import {
  classify,
  corroborates,
  offPer100gCalories,
  parseArgs,
  valuesMatch,
} from "../verify-barcode-cache-candidates.mjs";

const SCRIPT = join(__dirname, "..", "verify-barcode-cache-candidates.mjs");

/**
 * Every test here is hermetic. The CLI cases below only exercise argument
 * rejection, which returns BEFORE the first Open Food Facts request — that
 * ordering is the property under test, so a test that reached the network
 * would be evidence of a regression, not a flaky test.
 */
function runCli(args: string[]): { status: number | null; stderr: string } {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    timeout: 15_000,
  });
  return { status: r.status, stderr: r.stderr ?? "" };
}

describe("parseArgs — argument validation (P2 cache sweep)", () => {
  it("accepts the three-part form and returns numbers, not strings", () => {
    const { candidates, errors } = parseArgs(["3017620422003:182:100"]);
    expect(errors).toEqual([]);
    expect(candidates).toEqual([
      { code: "3017620422003", cal: 182, grams: 100 },
    ]);
  });

  it("accepts a bare barcode with null cached values", () => {
    const { candidates, errors } = parseArgs(["8000500037560"]);
    expect(errors).toEqual([]);
    expect(candidates).toEqual([
      { code: "8000500037560", cal: null, grams: null },
    ]);
  });

  // The regression this validation exists for: Number() coercion hid bad input
  // in BOTH directions and neither surfaced as an error. NaN compares false
  // everywhere, so a typo'd grams value reported `ok` and a poisoned row was
  // skipped; Infinity and 0 reported POISONED for a row nobody checked.
  it.each([
    ["3017620422003:182:abc", "servingGrams must be a number > 0"], // → NaN, was silently `ok`
    ["3017620422003:182:0", "servingGrams must be a number > 0"], // → Infinity, was false POISONED
    ["3017620422003:182:-5", "servingGrams must be a number > 0"],
    ["3017620422003::100", "cachedKcalPerServing must be a number >= 0"], // → 0, was false POISONED
    ["3017620422003:abc:100", "cachedKcalPerServing must be a number >= 0"],
    ["3017620422003:-1:100", "cachedKcalPerServing must be a number >= 0"],
  ])("rejects %s", (arg, expected) => {
    const { candidates, errors } = parseArgs([arg]);
    expect(candidates).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(expected);
  });

  it("rejects a two-part argument rather than guessing the missing field", () => {
    const { candidates, errors } = parseArgs(["3017620422003:182"]);
    expect(candidates).toEqual([]);
    expect(errors[0]).toContain("expected <barcode>");
  });

  it("rejects a non-numeric barcode", () => {
    const { errors } = parseArgs(["abc123:1:1"]);
    expect(errors[0]).toContain("barcode must be digits only");
  });

  it("reports EVERY bad argument, not just the first", () => {
    // One round-trip per typo would make a hand-assembled batch painful to fix.
    const { errors } = parseArgs([
      "3017620422003:182:abc",
      "060383653293::100",
      "nope:1:1",
    ]);
    expect(errors).toHaveLength(3);
  });

  it("reports errors even when some arguments are valid", () => {
    const { candidates, errors } = parseArgs([
      "3017620422003:182:100",
      "060383653293:257:abc",
    ]);
    expect(candidates).toHaveLength(1);
    expect(errors).toHaveLength(1);
  });
});

describe("verify-barcode-cache-candidates CLI", () => {
  it("exits 1 and checks nothing when an argument is malformed", () => {
    const { status, stderr } = runCli(["3017620422003:182:abc"]);
    expect(status).toBe(1);
    expect(stderr).toContain("nothing was checked");
    expect(stderr).toContain("servingGrams must be a number > 0");
  });

  it("exits 1 with usage when given no arguments", () => {
    const { status, stderr } = runCli([]);
    expect(status).toBe(1);
    expect(stderr).toContain("usage:");
  });
});

describe("classify — verdicts", () => {
  it("flags a row whose cached energy is far below OFF (Nutella)", () => {
    // Real remediation case: cached 182 kcal/100g against OFF's 539.
    const r = classify({
      off100: 539,
      P: 6.3,
      C: 57.5,
      F: 30.9,
      cal: 182,
      grams: 100,
    });
    expect(r.shielded).toBe("yes");
    expect(r.cached100).toBe(182);
    expect(r.verdict).toBe("POISONED");
  });

  it("flags a zero-energy product cached with calories (spring water)", () => {
    const r = classify({
      off100: 0,
      P: 0,
      C: 0,
      F: 0,
      cal: 257,
      grams: 500,
    });
    expect(r.shielded).toBe("zero-path");
    expect(r.cached100).toBe(51.4);
    expect(r.verdict).toBe("POISONED");
  });

  it("leaves a barcode OFF no longer resolves alone (Kinder Bueno)", () => {
    // off100 undefined → nothing to corroborate → the secondary source stands.
    const r = classify({
      off100: undefined,
      P: undefined,
      C: undefined,
      F: undefined,
      cal: 118,
      grams: 21.5,
    });
    expect(r.shielded).toBe("no");
    expect(r.verdict).toBe("ok");
  });

  it("returns a review verdict when no cached values were supplied", () => {
    const r = classify({
      off100: 539,
      P: 6.3,
      C: 57.5,
      F: 30.9,
      cal: null,
      grams: null,
    });
    expect(r.cached100).toBe("-");
    expect(r.verdict).toContain("review");
  });

  // CHARACTERIZATION, not endorsement: this pins a KNOWN limitation reported by
  // /code-review and deliberately left unfixed. The `materially` gate compares
  // calories only, so Cherry Coke's cached 6.5 vs OFF's 11.1 (a 4.6 delta,
  // inside max(5, off*0.25)) scores `ok` — even though that row carried 1.0 g
  // fat and 0.2 g protein for a cola, i.e. macros from a different food. If the
  // criterion is ever corrected to "would the current code produce a better
  // row?", this expectation SHOULD flip to POISONED; update it, don't preserve it.
  it("does NOT flag macro-only pollution when calories happen to be close", () => {
    const r = classify({
      off100: 11.1,
      P: 0,
      C: 2.7,
      F: 0,
      cal: 23,
      grams: 355,
    });
    expect(r.verdict).toBe("ok");
  });
});

describe("corroborates — mirrors offMacrosCorroborateEnergy", () => {
  it("returns false for absent or non-positive energy", () => {
    // Zero-energy entries belong to the explicit-zero path, which carries a kJ
    // contradiction guard this function deliberately does not replicate.
    expect(corroborates(undefined, 1, 1, 1)).toBe(false);
    expect(corroborates(0, 1, 1, 1)).toBe(false);
    expect(corroborates(-5, 1, 1, 1)).toBe(false);
  });

  it("returns false when there are no macros to compare against", () => {
    expect(corroborates(400, undefined, undefined, undefined)).toBe(false);
    expect(corroborates(400, 0, 0, 0)).toBe(false);
  });

  it("accepts a coherent label and rejects a typo'd energy field", () => {
    // Nutella: 4(6.3) + 4(57.5) + 9(30.9) = 533.3 vs a stated 539.
    expect(corroborates(539, 6.3, 57.5, 30.9)).toBe(true);
    // Granulated sugar with a wrong energy field: Atwater 400 vs a stated 50.
    expect(corroborates(50, 0, 100, 0)).toBe(false);
  });

  it("holds the 30% tolerance boundary", () => {
    // macroKcal 400: valuesMatch divides by max(|a|,|b|).
    expect(corroborates(400 * 0.75, 0, 100, 0)).toBe(true); // 25% off → inside
    expect(corroborates(400 * 0.5, 0, 100, 0)).toBe(false); // 50% off → outside
  });
});

describe("valuesMatch — mirrors verification-consensus", () => {
  it("treats identical values as matching", () => {
    expect(valuesMatch(0, 0, 0.3)).toBe(true);
  });

  it("uses an absolute floor when both values are below 2", () => {
    expect(valuesMatch(0.2, 1.0, 0.3)).toBe(true); // relative would fail
    expect(valuesMatch(0.2, 1.9, 0.3)).toBe(false); // diff > 1
  });

  it("uses the larger operand as the relative denominator", () => {
    expect(valuesMatch(75, 100, 0.25)).toBe(true); // 25/100
    expect(valuesMatch(70, 100, 0.25)).toBe(false); // 30/100
  });
});

describe("offPer100gCalories", () => {
  it("prefers the kcal field", () => {
    expect(
      offPer100gCalories({ "energy-kcal_100g": 539, energy_100g: 9999 }),
    ).toBe(539);
  });

  it("falls back to kJ with the same divisor the server uses", () => {
    expect(offPer100gCalories({ energy_100g: 2252 })).toBe(538); // 2252/4.1868
  });

  it("returns undefined when neither field is usable", () => {
    expect(offPer100gCalories({})).toBeUndefined();
    expect(offPer100gCalories({ "energy-kcal_100g": "N/A" })).toBeUndefined();
  });
});
