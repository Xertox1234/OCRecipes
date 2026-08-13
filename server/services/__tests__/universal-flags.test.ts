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

describe("evaluateUniversalFlags — FSA per-portion escalation (perServing > portionLine)", () => {
  it("escalates a food whose per100g is below the red line but perServing exceeds the portion line at servingGrams>100", () => {
    const flags = evaluateUniversalFlags({
      ...base,
      per100g: { sugar: 20 }, // below FSA_FOOD.sugar (22.5)
      perServing: { sugar: 30 }, // above FSA_PORTION.sugar (27)
      servingGrams: 250, // > 100
    });
    expect(ids(flags)).toContain("nutrient:sugar");
  });

  it("does NOT escalate when servingGrams <= 100, even with the same exceeding perServing value", () => {
    const flags = evaluateUniversalFlags({
      ...base,
      per100g: { sugar: 20 },
      perServing: { sugar: 30 },
      servingGrams: 100, // not > 100 — escalation gate does not open
    });
    expect(ids(flags)).not.toContain("nutrient:sugar");
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
  });
  it("CONTAINS (info, no mg) when serving mg is present but <150", () => {
    const f = evaluateUniversalFlags({
      ...base,
      perServing: { caffeine: 34 },
    }).find((x) => x.id === "nutrient:caffeine");
    expect(f?.severity).toBe("info");
    expect(f?.title).toBe("Contains caffeine");
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
  });
  it("NO flag with no mg and no signal (untrusted serving fails safe to nothing here)", () => {
    expect(evaluateUniversalFlags(base).map((x) => x.id)).not.toContain(
      "nutrient:caffeine",
    );
  });
  it("does NOT flag a German caffeine-free declaration ('koffeinfrei')", () => {
    expect(
      evaluateUniversalFlags({
        ...base,
        ingredientsText: "Wasser, koffeinfrei",
      }).map((x) => x.id),
    ).not.toContain("nutrient:caffeine");
  });
  it("does NOT flag an English 'caffeine-free' declaration", () => {
    expect(
      evaluateUniversalFlags({
        ...base,
        ingredientsText: "caffeine-free cola",
      }).map((x) => x.id),
    ).not.toContain("nutrient:caffeine");
  });
  it("does NOT flag a Spanish 'sin cafeína' declaration", () => {
    expect(
      evaluateUniversalFlags({
        ...base,
        ingredientsText: "café sin cafeína",
      }).map((x) => x.id),
    ).not.toContain("nutrient:caffeine");
  });
  it("does NOT flag when per100g caffeine is explicitly 0", () => {
    expect(
      evaluateUniversalFlags({
        ...base,
        per100g: { ...base.per100g, caffeine: 0 },
      }).map((x) => x.id),
    ).not.toContain("nutrient:caffeine");
  });
  it("does NOT flag when perServing caffeine is explicitly 0", () => {
    expect(
      evaluateUniversalFlags({
        ...base,
        perServing: { caffeine: 0 },
      }).map((x) => x.id),
    ).not.toContain("nutrient:caffeine");
  });
});

describe("evaluateUniversalFlags — sweeteners & nutriscore", () => {
  it("flags artificial sweeteners for aspartame (E951)", () => {
    const f = evaluateUniversalFlags({
      ...base,
      additivesTags: ["en:e951", "en:e150d"],
    }).find((x) => x.id === "sweetener:artificial");
    expect(f?.kind).toBe("sweetener");
    expect(f?.title).toBe("Contains artificial sweeteners");
    // Guards against an "insight" regression — this flag must stay on the
    // "nutrition" tier alongside the other universal flags.
    expect(f?.tier).toBe("nutrition");
  });
  it("does NOT flag natural stevia (E960) or caramel color (E150d)", () => {
    expect(
      evaluateUniversalFlags({
        ...base,
        additivesTags: ["en:e960", "en:e150d"],
      }).map((x) => x.id),
    ).not.toContain("sweetener:artificial");
  });
  it("emits a nutriscore grade flag carrying the grade", () => {
    const f = evaluateUniversalFlags({ ...base, nutriScore: "e" }).find(
      (x) => x.kind === "nutriscore",
    );
    expect(f?.id).toBe("nutriscore:e");
    expect(f?.grade).toBe("e");
  });
  it("ignores an unknown nutriscore value", () => {
    expect(
      evaluateUniversalFlags({ ...base, nutriScore: "unknown" }).some(
        (x) => x.kind === "nutriscore",
      ),
    ).toBe(false);
  });
});

describe("evaluateUniversalFlags — regression: fixed Nutella data now flags high sugar (P2-2026-07-22)", () => {
  it("fires nutrient:sugar (plus processing:ultra and nutriscore:e) once the source pollution fix corrects Nutella's per100g", () => {
    // Before the barcode-lookup fix (P2-2026-07-22), a name-matched secondary
    // replaced OFF's self-consistent Nutella label wholesale, so the flag
    // evaluator only ever saw the wrong low-sugar (3.1 g) data and never
    // fired nutrient:sugar. With the corrected data (56.3 g/100g, well above
    // the FSA food red line of 22.5), the sugar flag now fires alongside the
    // already-correct NOVA and Nutri-Score flags.
    const flags = evaluateUniversalFlags({
      ...base,
      // 10.6 = Nutella's real saturated fat/100g (30.9 is its TOTAL fat).
      per100g: { sugar: 56.3, saturatedFat: 10.6, sodium: 42.8 },
      categoriesTags: ["en:spreads"],
      novaGroup: 4,
      nutriScore: "e",
    });
    expect(ids(flags)).toContain("nutrient:sugar");
    expect(ids(flags)).toContain("processing:ultra");
    expect(ids(flags)).toContain("nutriscore:e");
  });
});

describe("evaluateUniversalFlags — severity drift guard", () => {
  // The client's shared `pickTopDisplayFlag` (shared/types/scan-flags.ts)
  // and the confirm-card/scan-lock chip's fail-dangerous "danger" haptic
  // (client/screens/ScanScreen.tsx) both rely on an invariant this module
  // never type-enforces: a nutrition-tier flag from evaluateUniversalFlags
  // is never `severity: "danger"` — only allergy (safety-tier) flags carry
  // "danger" (server/services/scan-flags.ts SEVERITY_TO_FLAG). If a future
  // nutrient/processing/sweetener addition were ever raised to "danger",
  // it would silently trigger allergy-styled UI/haptics for a non-allergen.
  // This is a strong worst-case fixture (every branch pushed to its highest
  // trigger), not exhaustive, but it fails loudly the moment the invariant
  // is violated instead of drifting silently.
  it('never emits severity: "danger" for any universal flag, across every branch', () => {
    const flags = evaluateUniversalFlags({
      per100g: { sugar: 999, saturatedFat: 999, sodium: 999, caffeine: 999 },
      perServing: { sugar: 999, saturatedFat: 999, sodium: 999, caffeine: 999 },
      servingGrams: 500,
      categoriesTags: ["en:beverages", "en:sodas", "en:energy-drinks"],
      novaGroup: 4,
      nutriScore: "e",
      additivesTags: ["en:e950", "en:e951"],
      ingredientsText: "Sugar, caffeine, artificial sweeteners",
    });
    expect(flags.length).toBeGreaterThan(0);
    for (const f of flags) {
      expect(f.severity).not.toBe("danger");
    }
  });

  // The fixture above always trips the caffeine ladder's `servingMg >=
  // CAFFEINE_HIGH_MG` branch first (severity "warn"), so the sibling
  // `else if (hasCaffeineSignal)` info-severity branch never runs there —
  // this second fixture drives ONLY that branch (no perServing at all, a
  // low per100g caffeine value below the high-dose threshold) so the
  // "across every branch" claim actually covers it.
  it('never emits severity: "danger" for the info-severity "Contains caffeine" branch specifically', () => {
    const flags = evaluateUniversalFlags({
      ...base,
      per100g: { caffeine: 5 },
    });
    const caffeineFlag = flags.find((f) => f.id === "nutrient:caffeine");
    expect(caffeineFlag?.severity).toBe("info");
    expect(caffeineFlag?.severity).not.toBe("danger");
  });
});

describe("emission coverage for previously-unpinned constants", () => {
  // FSA_DRINK.saturatedFat = 2.5 (per 100ml)
  it("flags a drink over the saturated-fat line", () => {
    const flags = evaluateUniversalFlags({
      ...base,
      per100g: { saturatedFat: 2.6 },
      categoriesTags: ["en:beverages"],
    });
    expect(flags.map((f) => f.id)).toContain("nutrient:saturated_fat");
  });

  it("does not flag a drink at or below the saturated-fat line", () => {
    const flags = evaluateUniversalFlags({
      ...base,
      per100g: { saturatedFat: 2.5 },
      categoriesTags: ["en:beverages"],
    });
    expect(flags.map((f) => f.id)).not.toContain("nutrient:saturated_fat");
  });

  // FSA_DRINK.sodium = 300 (mg per 100ml)
  it("flags a drink over the sodium line", () => {
    const flags = evaluateUniversalFlags({
      ...base,
      per100g: { sodium: 301 },
      categoriesTags: ["en:beverages"],
    });
    expect(flags.map((f) => f.id)).toContain("nutrient:sodium");
  });

  it("does not flag a drink at the sodium line", () => {
    const flags = evaluateUniversalFlags({
      ...base,
      per100g: { sodium: 300 },
      categoriesTags: ["en:beverages"],
    });
    expect(flags.map((f) => f.id)).not.toContain("nutrient:sodium");
  });

  // FSA_PORTION.saturatedFat = 6, only applies when servingGrams > 100
  it("flags saturated fat via the per-portion override", () => {
    const flags = evaluateUniversalFlags({
      ...base,
      per100g: { saturatedFat: 1.0 }, // under the per-100 line
      perServing: { saturatedFat: 6.1 },
      servingGrams: 240,
      categoriesTags: [],
    });
    expect(flags.map((f) => f.id)).toContain("nutrient:saturated_fat");
  });

  // FSA_PORTION.sodium = 720
  it("flags sodium via the per-portion override", () => {
    const flags = evaluateUniversalFlags({
      ...base,
      per100g: { sodium: 100 }, // under the per-100 line
      perServing: { sodium: 721 },
      servingGrams: 240,
      categoriesTags: [],
    });
    expect(flags.map((f) => f.id)).toContain("nutrient:sodium");
  });

  it("ignores the per-portion override for servings at or under 100g", () => {
    const flags = evaluateUniversalFlags({
      ...base,
      per100g: { sodium: 100 },
      perServing: { sodium: 721 },
      servingGrams: 100,
      categoriesTags: [],
    });
    expect(flags.map((f) => f.id)).not.toContain("nutrient:sodium");
  });
});

/**
 * CHARACTERISATION — the drink x per-portion cross.
 *
 * No test above reaches it: every per-portion test passes `categoriesTags: []`
 * (food) and every drink test omits `perServing`/`servingGrams`. The two axes
 * were never crossed, which is how a FOOD-scale portion table came to be
 * applied to beverages unnoticed.
 *
 * These pin what the code does TODAY, before the FSA drink portion table
 * lands. Two of them are expected to INVERT when it does, and the comment on
 * each says which way and why; the rest must not move at all. Written first
 * and green against unmodified source, so the threshold change fails loudly
 * rather than silently.
 */
describe("CHARACTERISATION — drink x per-portion, before the drink table", () => {
  const drink = ["en:beverages"];

  it("emits NOTHING for a 500 ml drink holding 20 g of sugar", () => {
    const flags = evaluateUniversalFlags({
      ...base,
      per100g: { sugar: 4 }, // 20 g / 500 ml — under FSA_DRINK.sugar.high 11.25
      perServing: { sugar: 20 },
      servingGrams: 500,
      categoriesTags: drink,
    });
    // WILL INVERT to a flag. The drink is judged on the per-100ml line and the
    // per-portion FOOD line simultaneously, and clears both: 4 < 11.25, and
    // 20 < 27. The FSA drink portion line is 13.5, so this should be RED.
    expect(ids(flags)).not.toContain("nutrient:sugar");
  });

  it("emits nothing for a 140 ml drink holding 14 g of sugar", () => {
    const flags = evaluateUniversalFlags({
      ...base,
      per100g: { sugar: 10 }, // 14 g / 140 ml — under FSA_DRINK.sugar.high 11.25
      perServing: { sugar: 14 },
      servingGrams: 140,
      categoriesTags: drink,
    });
    // MUST STAY GREEN — but for a DIFFERENT reason on each side of the fix, so
    // do not read it as a no-op. Today it passes because 14 is under the food
    // portion line of 27. Afterwards 14 IS over the drink portion line of
    // 13.5, and this stays silent only because the FSA drink trigger is a
    // portion over 150 ml rather than over 100. It is the one test here that
    // fails if the drink lines land without their trigger.
    expect(ids(flags)).not.toContain("nutrient:sugar");
  });

  it("escalates a 120 ml drink whose per-serving sugar clears the FOOD line", () => {
    const flags = evaluateUniversalFlags({
      ...base,
      per100g: { sugar: 5 },
      perServing: { sugar: 30 },
      servingGrams: 120,
      categoriesTags: drink,
    });
    // WILL INVERT to no flag: the FSA drink trigger is a portion over 150 ml,
    // so 120 ml earns no per-portion escalation at all.
    //
    // This input is reachable only by constructing it directly, as here. Both
    // production paths build `perServing` as `scaleNutrients(per100g, ...)`
    // (barcode-lookup.ts, label-override.ts), so a real record's two halves
    // always agree — and for a self-consistent drink at 120 ml, 30 g of sugar
    // is 25 g/100 ml, which clears the per-100 line of 11.25 on its own. The
    // claim is about the function, not about any record that reaches it.
    expect(ids(flags)).toContain("nutrient:sugar");
  });
});

/**
 * CHARACTERISATION — the FOOD portion arm, which the drink table must NOT
 * disturb. Every per100g here sits under its per-100 food line, so only the
 * portion arm can decide the outcome.
 */
describe("CHARACTERISATION — the food portion arm holds still", () => {
  it("fires just over each food portion line at a >100 g portion", () => {
    expect(
      ids(
        evaluateUniversalFlags({
          ...base,
          per100g: { sugar: 1 },
          perServing: { sugar: 27.1 },
          servingGrams: 240,
        }),
      ),
    ).toContain("nutrient:sugar");
    expect(
      ids(
        evaluateUniversalFlags({
          ...base,
          per100g: { saturatedFat: 0.1 },
          perServing: { saturatedFat: 6.1 },
          servingGrams: 240,
        }),
      ),
    ).toContain("nutrient:saturated_fat");
    expect(
      ids(
        evaluateUniversalFlags({
          ...base,
          per100g: { sodium: 10 },
          perServing: { sodium: 720.1 },
          servingGrams: 240,
        }),
      ),
    ).toContain("nutrient:sodium");
  });

  it("stays silent AT each food portion line (the line itself is not 'above')", () => {
    expect(
      ids(
        evaluateUniversalFlags({
          ...base,
          per100g: { sugar: 1 },
          perServing: { sugar: 27 },
          servingGrams: 240,
        }),
      ),
    ).not.toContain("nutrient:sugar");
    expect(
      ids(
        evaluateUniversalFlags({
          ...base,
          per100g: { saturatedFat: 0.1 },
          perServing: { saturatedFat: 6 },
          servingGrams: 240,
        }),
      ),
    ).not.toContain("nutrient:saturated_fat");
    expect(
      ids(
        evaluateUniversalFlags({
          ...base,
          per100g: { sodium: 10 },
          perServing: { sodium: 720 },
          servingGrams: 240,
        }),
      ),
    ).not.toContain("nutrient:sodium");
  });
});
