import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it, expect } from "vitest";
import { bootstrapMeanCI, mulberry32, BOOTSTRAP_SEED } from "../lib/bootstrap";

describe("bootstrap (side-effect-free module)", () => {
  // Pinned values, not run-twice equality: an unseeded resampler returns the
  // same interval on two runs ~45% of the time when the inputs are integers.
  // These inputs keep a chance match near 1 in 2000.
  it("reproduces the seeded interval", () => {
    const ci = bootstrapMeanCI([1.3, 2.9, 3.4, 4.8, 5.1, 6.7, 7.2, 9.6]);
    expect(ci.mean).toBeCloseTo(5.125, 9);
    expect(ci.lower).toBeCloseTo(3.4375, 9);
    expect(ci.upper).toBeCloseTo(7, 9);
  });

  it("brackets the sample mean", () => {
    const { mean, lower, upper } = bootstrapMeanCI([1, 2, 3, 4, 5]);
    expect(mean).toBe(3);
    expect(lower).toBeLessThanOrEqual(mean);
    expect(upper).toBeGreaterThanOrEqual(mean);
  });

  it("collapses degenerate inputs", () => {
    expect(bootstrapMeanCI([])).toEqual({ mean: 0, lower: 0, upper: 0 });
    expect(bootstrapMeanCI([7])).toEqual({ mean: 7, lower: 7, upper: 7 });
  });

  it("mulberry32 is a pure function of its seed", () => {
    const a = mulberry32(BOOTSTRAP_SEED);
    const b = mulberry32(BOOTSTRAP_SEED);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  // scripts/ci/eval-compare.ts imports this module so it never loads
  // runner-core.ts's import graph (dotenv, an Anthropic client, pg). One
  // import here would bring that back.
  it("imports nothing", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "../lib/bootstrap.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/^\s*import\b|\brequire\(/m);
  });
});
