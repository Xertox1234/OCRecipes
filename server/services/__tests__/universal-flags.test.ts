import { describe, it, expect } from "vitest";
import {
  evaluateUniversalFlags,
  type UniversalFlagInput,
} from "../universal-flags";
// The client's band layer, imported so the two can be compared directly. This
// file is scanned by no-server-fsa-constants.test.ts: importing shared symbols
// is fine, DECLARING an `FSA_`-prefixed const here is not.
import { concernBand } from "@shared/lib/nutrition-bands";

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
      perServing: { sugar: 30 }, // above FSA_PORTION_FOOD.lines.sugar (27)
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

  // FSA_PORTION_FOOD.lines.saturatedFat = 6, at a portion over 100 g
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

  // FSA_PORTION_FOOD.lines.sodium = 720
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
 * The drink x per-portion cross — the FSA drink portion table.
 *
 * No test above reaches this cross: every per-portion test passes
 * `categoriesTags: []` (food) and every drink test omits
 * `perServing`/`servingGrams`. The two axes were never crossed, which is how a
 * FOOD-scale portion table came to be applied to beverages unnoticed in two
 * layers at once.
 *
 * These three landed one commit earlier pinning the PRE-fix behaviour, so the
 * diff that introduced the drink table is the record of exactly which
 * emissions moved: the 500 ml case gained a flag, the 120 ml case lost one,
 * and the 140 ml case did not move at all.
 */
describe("evaluateUniversalFlags — drink x per-portion (FSA drink table)", () => {
  const drink = ["en:beverages"];

  it("emits NOTHING for a 500 ml drink holding 20 g of sugar", () => {
    const flags = evaluateUniversalFlags({
      ...base,
      per100g: { sugar: 4 }, // 20 g / 500 ml — under FSA_DRINK.sugar.high 11.25
      perServing: { sugar: 20 },
      servingGrams: 500,
      categoriesTags: drink,
    });
    // THE DEFECT, now fixed. Before the drink portion table this emitted
    // nothing at all: the bottle cleared the per-100ml line (4 < 11.25) and
    // was then measured against the per-portion FOOD line (20 < 27). Against
    // the published drink line of 13.5 it is a red, and 500 ml clears the
    // 150 ml trigger.
    expect(ids(flags)).toContain("nutrient:sugar");
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

  it("does NOT escalate a 120 ml drink, even over the FOOD portion line", () => {
    const flags = evaluateUniversalFlags({
      ...base,
      per100g: { sugar: 5 },
      perServing: { sugar: 30 },
      servingGrams: 120,
      categoriesTags: drink,
    });
    // The ONE emission this change removes. Before the drink trigger, 120 ml
    // cleared the food trigger of 100 and 30 g cleared the food line of 27,
    // so this flagged. The FSA drink trigger is a portion over 150 ml, so a
    // 120 ml portion earns no per-portion escalation at all.
    //
    // Removing a warning deserves the scrutiny the rest of this change does
    // not, so: this input is reachable only by constructing it directly, as
    // here. Both production paths build `perServing` as
    // `scaleNutrients(per100g, ...)` (barcode-lookup.ts, label-override.ts),
    // so a real record's two halves always agree — and for a self-consistent
    // drink at 120 ml, 30 g of sugar is 25 g/100 ml, which clears the per-100
    // line of 11.25 on its own and still flags. The claim is about the
    // function, not about any record that reaches it.
    expect(ids(flags)).not.toContain("nutrient:sugar");
  });
});

/**
 * The FOOD portion arm, which the drink table must NOT disturb. Every per100g
 * here sits under its per-100 food line, so only the portion arm can decide
 * the outcome. Landed with the characterisation commit and unchanged since —
 * that it never moved is the point.
 */
describe("evaluateUniversalFlags — the food portion arm holds still", () => {
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

/**
 * SERVER AND CLIENT MUST AGREE.
 *
 * `evaluateUniversalFlags` (server — emits the `nutrient:*` "Heads up" badge)
 * and `concernBand` (shared — drives the client's traffic-light row) implement
 * the same FSA rules twice, in two layers, from the same constants. Nothing
 * structural keeps them in step, and they have already drifted: the per-portion
 * table was food-only in both, then gated to the food scale in the band layer
 * alone, so for a whole release a drink could earn a badge from one and no
 * escalation at all from the other. `dropPanelBandedFlags` compares the two
 * verdicts on screen, so a disagreement is not academic — it decides whether
 * the user sees one warning, two, or none.
 *
 * Every product here is SELF-CONSISTENT (`perServing = per100 x portion/100`),
 * which is what both production paths build via `scaleNutrients`. That is the
 * domain over which the two layers are required to agree; hand-built
 * inconsistent inputs are not, and are covered separately above.
 *
 * The comparison is deliberately `flagEmitted === (band === "high")` rather
 * than two hardcoded expectations — a case added later cannot be filled in
 * wrongly on one side only.
 */
describe("evaluateUniversalFlags and concernBand agree on the same product", () => {
  const CASES = [
    // --- drink scale: the arm that was broken -------------------------------
    {
      what: "500 ml drink, 20 g sugar — portion arm only (the fixed defect)",
      drink: true,
      key: "sugar",
      flagId: "nutrient:sugar",
      per100: 4,
      portionGrams: 500,
    },
    {
      what: "140 ml drink, 14 g sugar — over the drink line, under the trigger",
      drink: true,
      key: "sugar",
      flagId: "nutrient:sugar",
      per100: 10,
      portionGrams: 140,
    },
    {
      what: "355 ml can, 39 g sugar — Cherry Coke",
      drink: true,
      key: "sugar",
      flagId: "nutrient:sugar",
      per100: 11.0,
      portionGrams: 355,
    },
    {
      what: "100 ml drink over the per-100 line — the other arm still fires",
      drink: true,
      key: "sugar",
      flagId: "nutrient:sugar",
      per100: 12.5,
      portionGrams: 100,
    },
    {
      what: "500 ml drink, 10 g sugar — under both lines",
      drink: true,
      key: "sugar",
      flagId: "nutrient:sugar",
      per100: 2,
      portionGrams: 500,
    },
    {
      what: "600 ml drink, 3.6 g saturated fat — the snake_case bridge",
      drink: true,
      key: "saturatedFat",
      flagId: "nutrient:saturated_fat",
      per100: 0.6,
      portionGrams: 600,
    },
    {
      what: "500 ml drink, 400 mg sodium — over the drink portion line",
      drink: true,
      key: "sodium",
      flagId: "nutrient:sodium",
      per100: 80,
      portionGrams: 500,
    },
    // --- food scale: must not have moved ------------------------------------
    {
      what: "240 g food, 24 g sugar — under the food portion line",
      drink: false,
      key: "sugar",
      flagId: "nutrient:sugar",
      per100: 10,
      portionGrams: 240,
    },
    {
      what: "240 g food, 28.8 g sugar — over the food portion line",
      drink: false,
      key: "sugar",
      flagId: "nutrient:sugar",
      per100: 12,
      portionGrams: 240,
    },
    {
      what: "100 g food over the per-100 line, portion arm shut",
      drink: false,
      key: "sugar",
      flagId: "nutrient:sugar",
      per100: 23,
      portionGrams: 100,
    },
    {
      what: "240 g food, 7.2 g saturated fat — over the food portion line",
      drink: false,
      key: "saturatedFat",
      flagId: "nutrient:saturated_fat",
      per100: 3,
      portionGrams: 240,
    },
  ] as const;

  it.each(CASES)("$what", ({ drink, key, flagId, per100, portionGrams }) => {
    const flags = evaluateUniversalFlags({
      ...base,
      per100g: { [key]: per100 },
      perServing: { [key]: (per100 * portionGrams) / 100 },
      servingGrams: portionGrams,
      categoriesTags: drink ? ["en:beverages"] : [],
    });
    const band = concernBand(
      key,
      per100,
      { kind: "resolved", scale: drink ? "drink" : "food", factor: 1 },
      portionGrams,
    );

    expect(ids(flags).includes(flagId)).toBe(band === "high");
  });

  it("exercises both verdicts, so the agreement is not vacuously one-sided", () => {
    // Without this, a bug that made BOTH layers silent for every case above
    // would leave every assertion trivially true.
    const verdicts = CASES.map(({ drink, key, per100, portionGrams }) =>
      concernBand(
        key,
        per100,
        { kind: "resolved", scale: drink ? "drink" : "food", factor: 1 },
        portionGrams,
      ),
    );
    expect(verdicts).toContain("high");
    expect(verdicts.filter((v) => v !== "high").length).toBeGreaterThan(0);
  });
});
