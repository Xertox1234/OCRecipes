import { describe, it, expect } from "vitest";

import { isBandedByPanel, dropPanelBandedFlags } from "../FlagSections-utils";
import type { NutrientBands } from "@shared/lib/nutrition-bands";
import type { ScanFlag, NutrientKind } from "@shared/types/scan-flags";

/** Shaped like the server's, titles verbatim from `NUTRIENT_META`. */
function nutrientFlag(nutrient: NutrientKind, title: string): ScanFlag {
  return {
    id: `nutrient:${nutrient}`,
    kind: "nutrient",
    severity: "warn",
    tier: "nutrition",
    nutrient,
    title,
  };
}

function bands(overrides: Partial<NutrientBands["concerns"]>): NutrientBands {
  return { concerns: { ...overrides }, benefits: {} };
}

describe("isBandedByPanel", () => {
  it("is true when the panel shows a real band for the flag's nutrient", () => {
    expect(
      isBandedByPanel(
        nutrientFlag("sugar", "High in sugar"),
        bands({ sugar: { band: "high", hasValue: true } }),
      ),
    ).toBe(true);
  });

  /**
   * The whole point of the round-1 fix. `concernBand` returns "unknown" for an
   * unresolvable basis AND for an absent value, and the panel renders neither
   * a dot nor a tag for it — so nothing on screen is making this judgement and
   * the server's badge is the only thing that can.
   */
  it("is FALSE for an `unknown` band — that is not a band", () => {
    expect(
      isBandedByPanel(
        nutrientFlag("sugar", "High in sugar"),
        bands({ sugar: { band: "unknown", hasValue: true } }),
      ),
    ).toBe(false);
  });

  it("is false when the nutrient is absent from the bands entirely", () => {
    expect(
      isBandedByPanel(nutrientFlag("sodium", "High in sodium"), bands({})),
    ).toBe(false);
  });

  /**
   * `saturated_fat` → `saturatedFat` is the ONLY case that can prove the
   * snake_case → camelCase table is alive: `sugar` and `sodium` are spelled
   * identically in both unions, so a dead mapping still "works" for them. A
   * broken bridge here returns false — the badge survives, which looks
   * cautious and hides the fact that the mapping does nothing.
   */
  it("bridges snake_case NutrientKind to camelCase ConcernNutrient", () => {
    expect(
      isBandedByPanel(
        nutrientFlag("saturated_fat", "High in saturated fat"),
        bands({ saturatedFat: { band: "medium", hasValue: true } }),
      ),
    ).toBe(true);
  });

  /**
   * Caffeine's panel row is unbanded — value only — so its badge is the only
   * thing that can warn about it, whatever the bands say. It also ships as
   * `kind: "nutrient"`, which is why the filter keys on `nutrient` and not on
   * `kind`.
   */
  it("is false for caffeine, whose panel row publishes no band", () => {
    expect(
      isBandedByPanel(
        nutrientFlag("caffeine", "High in caffeine"),
        bands({ sugar: { band: "high", hasValue: true } }),
      ),
    ).toBe(false);
  });

  /**
   * The fail-dangerous "we couldn't check" flag, and every non-nutrient kind:
   * no `nutrient` field at all, so nothing can claim the panel covers it.
   */
  it("is false for a flag with no nutrient field", () => {
    const unavailable: ScanFlag = {
      id: "nutrient-unavailable",
      kind: "nutrient-unavailable",
      severity: "warn",
      tier: "nutrition",
      title: "Couldn't check nutrition",
    };
    expect(
      isBandedByPanel(
        unavailable,
        bands({ sugar: { band: "high", hasValue: true } }),
      ),
    ).toBe(false);
  });
});

describe("dropPanelBandedFlags", () => {
  it("drops each nutrient independently and preserves order", () => {
    const flags = [
      nutrientFlag("sugar", "High in sugar"),
      nutrientFlag("saturated_fat", "High in saturated fat"),
      nutrientFlag("sodium", "High in sodium"),
      nutrientFlag("caffeine", "Contains caffeine"),
    ];

    const kept = dropPanelBandedFlags(
      flags,
      bands({
        sugar: { band: "medium", hasValue: true },
        saturatedFat: { band: "low", hasValue: true },
        // Sodium has a value nowhere, so the panel cannot judge it.
        sodium: { band: "unknown", hasValue: false },
      }),
    );

    expect(kept.map((f) => f.title)).toEqual([
      "High in sodium",
      "Contains caffeine",
    ]);
  });

  it("keeps every flag when nothing is banded", () => {
    const flags = [
      nutrientFlag("sugar", "High in sugar"),
      nutrientFlag("sodium", "High in sodium"),
    ];

    expect(dropPanelBandedFlags(flags, bands({}))).toHaveLength(2);
  });
});
