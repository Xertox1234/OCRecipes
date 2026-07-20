import { describe, it, expect } from "vitest";
import {
  evaluateScanFlags,
  buildScanResponseFlags,
  PROFILE_UNAVAILABLE_FLAG,
  type ScanFlagProductInput,
} from "../scan-flags";

const withData = (
  over: Partial<ScanFlagProductInput> = {},
): ScanFlagProductInput => ({
  allergenTags: [],
  ingredientsText: null,
  allergenDataAvailable: true,
  ...over,
});
const peanutAllergy = [{ name: "peanuts", severity: "severe" as const }];

describe("evaluateScanFlags — allergen matching", () => {
  it("matches via OFF tag when ingredient text is missing", () => {
    const flags = evaluateScanFlags(
      withData({ allergenTags: ["en:peanuts"] }),
      peanutAllergy,
    );
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({
      kind: "allergen",
      allergenId: "peanuts",
      severity: "danger",
      tier: "safety",
    });
    expect(flags[0].title).toContain("Peanuts");
  });

  it("matches via ingredient text when the OFF tag is missing (disagreement case)", () => {
    const flags = evaluateScanFlags(
      withData({
        allergenTags: [],
        ingredientsText: "sugar, roasted peanuts, salt",
      }),
      peanutAllergy,
    );
    expect(flags).toHaveLength(1);
    expect(flags[0].allergenId).toBe("peanuts");
  });

  it("returns the UNION across signals and de-dups one flag per allergen", () => {
    const flags = evaluateScanFlags(
      withData({
        allergenTags: ["en:peanuts"],
        ingredientsText: "peanuts, milk",
      }),
      [
        { name: "peanuts", severity: "severe" },
        { name: "milk", severity: "mild" },
      ],
    );
    expect(flags.map((f) => f.allergenId).sort()).toEqual(["milk", "peanuts"]);
  });

  it("maps stored severity to flag severity (severe→danger, moderate→warn, mild→info)", () => {
    const sev = (s: "mild" | "moderate" | "severe") =>
      evaluateScanFlags(withData({ allergenTags: ["en:milk"] }), [
        { name: "milk", severity: s },
      ])[0].severity;
    expect(sev("severe")).toBe("danger");
    expect(sev("moderate")).toBe("warn");
    expect(sev("mild")).toBe("info");
  });

  it("emits NOTHING when the user has no allergies", () => {
    expect(
      evaluateScanFlags(withData({ allergenTags: ["en:peanuts"] }), []),
    ).toEqual([]);
  });

  it("FAIL-DANGEROUS: user has allergies but data unavailable → explicit unverified flag, no silence", () => {
    const flags = evaluateScanFlags(
      withData({ allergenDataAvailable: false }),
      peanutAllergy,
    );
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({
      kind: "allergen-unavailable",
      severity: "warn",
      tier: "safety",
    });
  });

  it("does not flag allergens the user did not declare", () => {
    expect(
      evaluateScanFlags(withData({ allergenTags: ["en:milk"] }), peanutAllergy),
    ).toEqual([]);
  });
});

describe("buildScanResponseFlags — profile outcome", () => {
  it("returns PROFILE_UNAVAILABLE_FLAG when the profile read failed", () => {
    expect(buildScanResponseFlags(withData(), { ok: false })).toEqual([
      PROFILE_UNAVAILABLE_FLAG,
    ]);
  });

  it("delegates to evaluateScanFlags when the profile read succeeded", () => {
    const flags = buildScanResponseFlags(
      withData({ allergenTags: ["en:peanuts"] }),
      {
        ok: true,
        allergies: peanutAllergy,
      },
    );
    expect(flags[0].allergenId).toBe("peanuts");
  });
});
