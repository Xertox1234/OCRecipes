import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import {
  classify,
  parseArgs,
  resolveOffProduct,
  type FetchLike,
} from "../verify-barcode-cache-candidates";

const ROOT = join(__dirname, "..", "..");
const SCRIPT = join(ROOT, "scripts", "verify-barcode-cache-candidates.ts");

/**
 * Every test here is hermetic. The CLI cases below only exercise argument
 * rejection, which returns BEFORE the first Open Food Facts request — that
 * ordering is the property under test, so a test that reached the network
 * would be evidence of a regression, not a flaky test.
 *
 * DATABASE_URL is stripped from the spawn env: the script imports the real
 * production policy from server/services/barcode-policy.ts, and booting
 * without a database is part of its contract (it is a read-only OFF checker).
 *
 * The policy functions themselves (offMacrosCorroborateEnergy, valuesMatch,
 * offEnergyKcal) are no longer mirrored here — they are imported, and their
 * behaviour is pinned by server/services/__tests__/barcode-lookup.test.ts,
 * server/lib/__tests__/verification-consensus.test.ts, and
 * server/services/__tests__/barcode-policy.test.ts.
 */
function runCli(args: string[]): { status: number | null; stderr: string } {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  const r = spawnSync(process.execPath, ["--import=tsx", SCRIPT, ...args], {
    encoding: "utf8",
    timeout: 15_000,
    cwd: ROOT,
    env,
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

  // The Cherry Coke prod case: cached 6.5 vs OFF's 11.1 kcal/100ml is inside
  // any reasonable calorie threshold, but the row carried 1.0 g fat and 0.2 g
  // protein for a cola — macros from a different food. The criterion is not
  // "do the calories differ materially?" but "would the current code produce a
  // better row?": the source is a secondary AND OFF now shields the entry.
  // (This flips the former characterization test that pinned the calorie-only
  // limitation.)
  it("flags macro-only pollution even when calories are close (Cherry Coke prod case)", () => {
    const r = classify({
      off100: 11.1,
      P: 0,
      C: 2.7,
      F: 0,
      cal: 23,
      grams: 355,
    });
    expect(r.verdict).toBe("POISONED");
  });

  it("flags a shielded row even when cached energy matches OFF exactly (bias toward delete)", () => {
    // Deleting costs nothing — the row re-seeds identically on next scan — so
    // any secondary-source row the current policy would shield is worth
    // re-seeding; matching calories are a symptom, not the criterion.
    const r = classify({
      off100: 539,
      P: 6.3,
      C: 57.5,
      F: 30.9,
      cal: 539,
      grams: 100,
    });
    expect(r.shielded).toBe("yes");
    expect(r.verdict).toBe("POISONED");
  });

  it("leaves an unshielded OFF entry alone even when values differ wildly", () => {
    // Energy contradicts its own macros (Atwater 400 vs stated 50): the
    // current code would NOT shield this entry, so deleting the cached row
    // would just re-seed the same secondary answer. Not poisoned.
    const r = classify({
      off100: 50,
      P: 0,
      C: 100,
      F: 0,
      cal: 400,
      grams: 100,
    });
    expect(r.shielded).toBe("no");
    expect(r.verdict).toBe("ok");
  });
});

/** Fake OFF: resolves the given variants, cleanly misses everything else. */
function offWith(
  hits: Record<string, { product_name?: string }>,
  log?: string[],
): FetchLike {
  return (url) => {
    const code = /product\/(\d+)\.json$/.exec(String(url))?.[1] ?? "";
    log?.push(code);
    const product = hits[code];
    return Promise.resolve({
      json: () =>
        Promise.resolve(product ? { status: 1, product } : { status: 0 }),
    });
  };
}

describe("resolveOffProduct — OFF padding variants", () => {
  it("tries variants in production order and stops at the first hit", async () => {
    // Production (lookupBarcode) takes the FIRST variant OFF resolves; the
    // sweep must replicate that or it classifies a different product.
    const requested: string[] = [];
    const fetchImpl = offWith(
      { "0000006772408": { product_name: "Cherry Coke" } },
      requested,
    );
    const r = await resolveOffProduct("06772408", { fetchImpl });
    expect(r.product?.product_name).toBe("Cherry Coke");
    expect(r.matchedVariant).toBe("0000006772408");
    // Exactly the variants BEFORE the hit, in production order — no extras.
    expect(requested).toEqual(["06772408", "000006772408", "0000006772408"]);
  });

  it("resolves a row cached under a form OFF does not index via its padded variant", async () => {
    // The dev cache's spring-water pair: a row cached as `060383653293` while
    // OFF indexes `0060383653293`. Literal-only querying reported
    // "(not in OFF)" → LEGITIMATE and the poisoned row survived forever.
    const fetchImpl = offWith({
      "0060383653293": { product_name: "Natural Spring Water" },
    });
    const r = await resolveOffProduct("060383653293", { fetchImpl });
    expect(r.product?.product_name).toBe("Natural Spring Water");
    expect(r.matchedVariant).toBe("0060383653293");
  });

  it("returns no product and no errors when every variant is a clean miss", async () => {
    const r = await resolveOffProduct("8000500037560", {
      fetchImpl: offWith({}),
    });
    expect(r.product).toBeNull();
    expect(r.errors).toEqual([]);
  });

  it("records an error when a variant rejects and nothing resolves", async () => {
    const fetchImpl: FetchLike = () =>
      Promise.reject(new Error("socket hang up"));
    const r = await resolveOffProduct("06772408", { fetchImpl });
    expect(r.product).toBeNull();
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0]).toContain("socket hang up");
  });

  it("keeps going past an early variant error when a later variant resolves", async () => {
    // Mirrors production: a per-variant fetch error is logged and the loop
    // continues — an error on the literal form must not mask a padded hit.
    let calls = 0;
    const fetchImpl: FetchLike = (url) => {
      calls++;
      if (calls === 1) return Promise.reject(new Error("timeout"));
      return offWith({ "000006772408": { product_name: "Cherry Coke" } })(url);
    };
    const r = await resolveOffProduct("06772408", { fetchImpl });
    expect(r.product?.product_name).toBe("Cherry Coke");
    expect(r.matchedVariant).toBe("000006772408");
  });
});
