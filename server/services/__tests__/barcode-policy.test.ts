import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { barcodeVariants, offEnergyKcal } from "../barcode-policy";

describe("barcodeVariants", () => {
  it("generates the padded form a row may be cached under (dev spring-water pair)", () => {
    // The dev cache held `060383653293` and `0060383653293` as separate rows —
    // a sweep that queries only the literal barcode misses one of them.
    expect(barcodeVariants("060383653293")).toContain("0060383653293");
  });

  it("returns the original code first, then padded and check-digit forms in production order", () => {
    // Pinned as an ordered array, not a set: lookupBarcode takes the FIRST
    // variant OFF resolves, so insertion order is part of the policy.
    expect(barcodeVariants("06772408")).toEqual([
      "06772408", // original
      "000006772408", // zero-padded to UPC-A length
      "0000006772408", // zero-padded to EAN-13 length
      "000067724086", // UPC-A with computed check digit
      "0000067724086", // EAN-13 with computed check digit
    ]);
  });

  it("does not pad or extend 13-digit codes", () => {
    expect(barcodeVariants("3017620422003")).toEqual(["3017620422003"]);
  });
});

describe("offEnergyKcal", () => {
  it("prefers the kcal field over the kJ field", () => {
    expect(offEnergyKcal(539, 9999)).toBe(539);
  });

  it("falls back to kJ with the same divisor the server uses", () => {
    expect(offEnergyKcal(undefined, 2252)).toBe(538); // 2252 / 4.1868
  });

  it("keeps an explicit zero kcal instead of falling through to kJ", () => {
    // `??`, not `||`: a genuine 0-kcal product (water) must not be replaced
    // by a stale kJ field.
    expect(offEnergyKcal(0, 2252)).toBe(0);
  });

  it("returns undefined when neither field is present", () => {
    expect(offEnergyKcal(undefined, undefined)).toBeUndefined();
  });
});

describe("module import graph", () => {
  it("is importable without DATABASE_URL (stays db-free)", () => {
    // The whole point of this module: the cache-sweep CLI imports the real
    // production policy WITHOUT dragging in server/db.ts, which throws at
    // module load when DATABASE_URL is unset. If this test fails, an import
    // was added that reaches the storage/db graph.
    const ROOT = join(__dirname, "..", "..", "..");
    const policyPath = join(ROOT, "server", "services", "barcode-policy.ts");
    const env = { ...process.env };
    delete env.DATABASE_URL;
    const r = spawnSync(
      process.execPath,
      [
        "--import=tsx",
        "--input-type=module",
        "-e",
        `await import(${JSON.stringify(policyPath)})`,
      ],
      { encoding: "utf8", timeout: 15_000, cwd: ROOT, env },
    );
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });
});
