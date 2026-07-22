import { describe, it, expect } from "vitest";
import {
  evaluateUniversalFlags,
  type UniversalFlagInput,
} from "../universal-flags";

const base: UniversalFlagInput = {
  per100g: {},
  categoriesTags: [],
  additivesTags: [],
  ingredientsText: null,
};
const ids = (fl: { id: string }[]) => fl.map((f) => f.id);

describe("evaluateUniversalFlags — FSA nutrient flags", () => {
  it("flags high sugar for a solid over the FSA food red line (>22.5 g/100g)", () => {
    const flags = evaluateUniversalFlags({ ...base, per100g: { sugar: 30 } });
    expect(ids(flags)).toContain("nutrient:sugar");
    expect(flags[0].tier).toBe("nutrition");
    expect(flags[0].kind).toBe("nutrient");
  });
  it("does NOT flag a solid at 12 g sugar/100g", () => {
    expect(
      ids(evaluateUniversalFlags({ ...base, per100g: { sugar: 12 } })),
    ).not.toContain("nutrient:sugar");
  });
  it("uses the lower BEVERAGE line: 12 g sugar/100ml flags for a drink", () => {
    const flags = evaluateUniversalFlags({
      ...base,
      per100g: { sugar: 12 },
      categoriesTags: ["en:beverages", "en:sodas"],
    });
    expect(ids(flags)).toContain("nutrient:sugar");
  });
  it("flags high sodium via the mg threshold (>600 mg/100g food), single conversion", () => {
    expect(
      ids(evaluateUniversalFlags({ ...base, per100g: { sodium: 700 } })),
    ).toContain("nutrient:sodium");
  });
  it("flags high saturated fat for a solid over 5 g/100g", () => {
    expect(
      ids(evaluateUniversalFlags({ ...base, per100g: { saturatedFat: 6 } })),
    ).toContain("nutrient:saturated_fat");
  });
  it("emits no nutrient flags when the nutrients are absent (fail-safe)", () => {
    expect(evaluateUniversalFlags(base)).toEqual([]);
  });
});

describe("evaluateUniversalFlags — NOVA", () => {
  it("flags ultra-processed for NOVA 4", () => {
    const flags = evaluateUniversalFlags({ ...base, novaGroup: 4 });
    const f = flags.find((x) => x.id === "processing:ultra");
    expect(f).toBeDefined();
    expect(f?.kind).toBe("processing");
    expect(f?.severity).toBe("warn");
    expect(f?.tier).toBe("nutrition");
  });
  it("does NOT flag NOVA 3 in v1", () => {
    expect(
      evaluateUniversalFlags({ ...base, novaGroup: 3 }).map((x) => x.id),
    ).not.toContain("processing:ultra");
  });
  it("does NOT flag when nova is absent", () => {
    expect(evaluateUniversalFlags(base).map((x) => x.id)).not.toContain(
      "processing:ultra",
    );
  });
});

describe("evaluateUniversalFlags — caffeine ladder", () => {
  it("HIGH with mg when a trusted serving is >=150mg", () => {
    const f = evaluateUniversalFlags({
      ...base,
      perServing: { caffeine: 160 },
    }).find((x) => x.id === "nutrient:caffeine");
    expect(f?.severity).toBe("warn");
    expect(f?.title).toContain("High in caffeine");
    expect(f?.value).toEqual({ amount: 160, unit: "mg" });
  });
  it("CONTAINS (info, no mg) when serving mg is present but <150", () => {
    const f = evaluateUniversalFlags({
      ...base,
      perServing: { caffeine: 34 },
    }).find((x) => x.id === "nutrient:caffeine");
    expect(f?.severity).toBe("info");
    expect(f?.title).toBe("Contains caffeine");
    expect(f?.value).toBeUndefined();
  });
  it("CONTAINS via multilingual ingredient text when no mg (German 'Koffein')", () => {
    const f = evaluateUniversalFlags({
      ...base,
      ingredientsText: "Wasser, Zucker, Koffein",
    }).find((x) => x.id === "nutrient:caffeine");
    expect(f?.severity).toBe("info");
  });
  it("CONTAINS via category when no mg and no ingredient match", () => {
    const f = evaluateUniversalFlags({
      ...base,
      categoriesTags: ["en:beverages", "en:energy-drinks"],
    }).find((x) => x.id === "nutrient:caffeine");
    expect(f?.severity).toBe("info");
  });
  it("CONTAINS (info, no mg) when only per100g caffeine is high and no serving is set", () => {
    const f = evaluateUniversalFlags({
      ...base,
      per100g: { ...base.per100g, caffeine: 200 },
    }).find((x) => x.id === "nutrient:caffeine");
    expect(f?.severity).toBe("info");
    expect(f?.title).toBe("Contains caffeine");
    expect(f?.value).toBeUndefined();
  });
  it("NO flag with no mg and no signal (untrusted serving fails safe to nothing here)", () => {
    expect(evaluateUniversalFlags(base).map((x) => x.id)).not.toContain(
      "nutrient:caffeine",
    );
  });
});
