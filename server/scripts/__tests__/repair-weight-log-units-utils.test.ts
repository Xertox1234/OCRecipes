import { describe, it, expect } from "vitest";
import { KG_PER_LB } from "@shared/lib/units";
import {
  classifyRow,
  isImplausibleWeight,
  MAX_PLAUSIBLE_WEIGHT_KG,
  parseCutoffArg,
  restoreKgFromCorrupted,
  type WeightRow,
} from "../repair-weight-log-units-utils";

const CUTOFF = new Date("2026-05-18T13:29:43Z");

function row(overrides: Partial<WeightRow> = {}): WeightRow {
  return {
    id: 1,
    userId: "user-1",
    weight: 30,
    unit: "kg",
    source: "manual",
    loggedAt: new Date("2026-05-10T00:00:00Z"),
    ...overrides,
  };
}

describe("restoreKgFromCorrupted", () => {
  it("inverts the kg→lb corruption", () => {
    // A real 100kg entry was stored as 100 * KG_PER_LB.
    const corrupted = 100 * KG_PER_LB;
    expect(restoreKgFromCorrupted(corrupted)).toBe(100);
  });

  it("rounds to 2 decimal places (weight column is decimal(6,2))", () => {
    const restored = restoreKgFromCorrupted(33.3);
    expect(restored).toBe(Math.round((33.3 / KG_PER_LB) * 100) / 100);
    expect(Number.isInteger(restored * 100)).toBe(true);
  });
});

describe("isImplausibleWeight", () => {
  it("accepts normal body weights", () => {
    expect(isImplausibleWeight(70)).toBe(false);
    expect(isImplausibleWeight(MAX_PLAUSIBLE_WEIGHT_KG)).toBe(false);
  });

  it("rejects non-positive, non-finite, and oversized values", () => {
    expect(isImplausibleWeight(0)).toBe(true);
    expect(isImplausibleWeight(-5)).toBe(true);
    expect(isImplausibleWeight(Number.NaN)).toBe(true);
    expect(isImplausibleWeight(MAX_PLAUSIBLE_WEIGHT_KG + 0.01)).toBe(true);
  });
});

describe("classifyRow", () => {
  it("flags a manual pre-cutoff row as corrupted", () => {
    expect(classifyRow(row(), CUTOFF)).toBe("corrupted");
  });

  it("treats a null source as manual", () => {
    expect(classifyRow(row({ source: null }), CUTOFF)).toBe("corrupted");
  });

  it("leaves non-manual sources untouched even when pre-cutoff", () => {
    expect(classifyRow(row({ source: "healthkit" }), CUTOFF)).toBe("healthy");
    expect(classifyRow(row({ source: "scale" }), CUTOFF)).toBe("healthy");
  });

  it("leaves non-kg rows untouched (the bug always stored 'kg')", () => {
    expect(classifyRow(row({ unit: "lb" }), CUTOFF)).toBe("healthy");
    expect(classifyRow(row({ unit: null }), CUTOFF)).toBe("healthy");
  });

  it("leaves rows logged at/after the cutoff untouched", () => {
    expect(classifyRow(row({ loggedAt: CUTOFF }), CUTOFF)).toBe("healthy");
    expect(
      classifyRow(row({ loggedAt: new Date("2026-06-01T00:00:00Z") }), CUTOFF),
    ).toBe("healthy");
  });

  it("flags needs-review when reversal yields an implausible weight", () => {
    // Stored value whose reversal exceeds the plausible bound.
    const corruptedHuge = (MAX_PLAUSIBLE_WEIGHT_KG + 100) * KG_PER_LB;
    expect(classifyRow(row({ weight: corruptedHuge }), CUTOFF)).toBe(
      "needs-review",
    );
  });
});

describe("parseCutoffArg", () => {
  it("parses a valid ISO-8601 timestamp", () => {
    expect(parseCutoffArg("2026-05-18T13:29:43Z").toISOString()).toBe(
      "2026-05-18T13:29:43.000Z",
    );
  });

  it("throws when the argument is missing", () => {
    expect(() => parseCutoffArg(undefined)).toThrow(/required/);
  });

  it("throws on an unparseable value", () => {
    expect(() => parseCutoffArg("not-a-date")).toThrow(/not a valid/);
  });

  it("throws when the cutoff is in the future", () => {
    const now = new Date("2026-05-18T13:29:43Z");
    expect(() => parseCutoffArg("2026-06-01T00:00:00Z", now)).toThrow(
      /in the future/,
    );
  });
});
