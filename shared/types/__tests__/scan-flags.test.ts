import { describe, it, expect } from "vitest";
import {
  pickTopSafetyFlag,
  pickTopFlag,
  createAllergenUnavailableFlag,
  type ScanFlag,
} from "@shared/types/scan-flags";

const flag = (over: Partial<ScanFlag>): ScanFlag => ({
  id: "x",
  kind: "allergen",
  severity: "info",
  tier: "safety",
  title: "t",
  ...over,
});

describe("pickTopSafetyFlag", () => {
  it("returns the highest-severity safety flag (danger > warn > info)", () => {
    const flags = [
      flag({ severity: "info" }),
      flag({ severity: "danger" }),
      flag({ severity: "warn" }),
    ];
    expect(pickTopSafetyFlag(flags)?.severity).toBe("danger");
  });

  it("ignores non-safety (insight) flags", () => {
    const flags = [
      flag({ severity: "danger", tier: "insight" }),
      flag({ severity: "info", tier: "safety" }),
    ];
    expect(pickTopSafetyFlag(flags)?.severity).toBe("info");
  });

  it("returns undefined when there are no safety flags", () => {
    expect(pickTopSafetyFlag([])).toBeUndefined();
    expect(pickTopSafetyFlag([flag({ tier: "insight" })])).toBeUndefined();
  });
});

describe("createAllergenUnavailableFlag", () => {
  it("derives id/kind/severity/tier from the default and takes the given detail", () => {
    const result = createAllergenUnavailableFlag({
      detail: "We don't have allergen data for this product.",
    });
    expect(result).toEqual({
      id: "allergen-unavailable",
      kind: "allergen-unavailable",
      severity: "warn",
      tier: "safety",
      title: "Couldn't verify allergens",
      detail: "We don't have allergen data for this product.",
    });
  });

  it("allows overriding id and title for a distinct situation (e.g. profile-read failure)", () => {
    const result = createAllergenUnavailableFlag({
      id: "profile-unavailable",
      title: "Couldn't check against your profile",
      detail: "We couldn't load your allergy profile just now.",
    });
    expect(result).toEqual({
      id: "profile-unavailable",
      kind: "allergen-unavailable",
      severity: "warn",
      tier: "safety",
      title: "Couldn't check against your profile",
      detail: "We couldn't load your allergy profile just now.",
    });
  });
});

const f = (over: Partial<ScanFlag>): ScanFlag => ({
  id: "x",
  kind: "nutrient",
  severity: "info",
  tier: "nutrition",
  title: "t",
  ...over,
});

describe("pickTopFlag", () => {
  it("returns the highest-severity flag", () => {
    const top = pickTopFlag([
      f({ severity: "info" }),
      f({ severity: "danger" }),
      f({ severity: "warn" }),
    ]);
    expect(top?.severity).toBe("danger");
  });
  it("breaks severity ties toward the allergen flag", () => {
    const allergen = f({
      id: "a",
      kind: "allergen",
      severity: "warn",
      tier: "safety",
    });
    const nutrient = f({ id: "n", kind: "nutrient", severity: "warn" });
    expect(pickTopFlag([nutrient, allergen])?.id).toBe("a");
  });
  it("returns undefined for an empty list", () => {
    expect(pickTopFlag([])).toBeUndefined();
  });
});
