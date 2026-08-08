import { describe, it, expect } from "vitest";

import { isBandedByPanel, dropPanelBandedFlags } from "../FlagSections-utils";
import type { NutrientBands } from "@shared/lib/nutrition-bands";
import type {
  ScanFlag,
  NutrientKind,
  ScanFlagSeverity,
} from "@shared/types/scan-flags";

/**
 * Shaped like the server's, titles verbatim from `NUTRIENT_META`.
 *
 * `severity` defaults to `"warn"` because that is the ONLY severity
 * `evaluateUniversalFlags` emits for a `high(...)` nutrient flag
 * (`server/services/universal-flags.ts:90,125,154`); the `info` overload
 * exercises the other branch of the agreement rule.
 */
function nutrientFlag(
  nutrient: NutrientKind,
  title: string,
  severity: ScanFlagSeverity = "warn",
): ScanFlag {
  return {
    id: `nutrient:${nutrient}`,
    kind: "nutrient",
    severity,
    tier: "nutrition",
    nutrient,
    title,
  };
}

function bands(overrides: Partial<NutrientBands["concerns"]>): NutrientBands {
  return { concerns: { ...overrides }, benefits: {} };
}

describe("isBandedByPanel", () => {
  it("is true when the panel's band AGREES with a warn-severity badge", () => {
    expect(
      isBandedByPanel(
        nutrientFlag("sugar", "High in sugar"),
        bands({ sugar: { band: "high", hasValue: true } }),
      ),
    ).toBe(true);
  });

  /**
   * The round-2 fix, and the flagship Trust-the-Label product proves it.
   *
   * Cherry Coke: 39 g sugar in a 355 mL can = 10.99 g per 100 mL, against
   * `FSA_DRINK.sugar.high` = 11.25 → the panel bands MEDIUM. The server bands
   * the same can HIGH, because `high()`'s SECOND clause
   * (`server/services/universal-flags.ts:55-70`) fires on the per-PORTION line:
   * `servingGrams 355 > 100 && perServing 39 > FSA_PORTION.sugar 27`. That
   * clause is reachable on real records — `server/routes/nutrition.ts:99-107`
   * populates `perServing` whenever `isServingDataTrusted`, and
   * `server/services/label-override.ts:190-191` sets serving-trusted expressly
   * so the per-portion path runs.
   *
   * The panel CANNOT reproduce that judgement: it passes no `portionGrams` to
   * `concernBand` on purpose (`nutrition-band-source.ts` — a portion-aware band
   * would move with the user's serving choice). So a MEDIUM band does not
   * replace a HIGH warning; it is a strictly weaker statement about the same
   * nutrient, and deleting the badge loses the warning outright. `main` showed
   * this badge.
   */
  it("is FALSE when a warn badge says HIGH and the panel only bands MEDIUM", () => {
    expect(
      isBandedByPanel(
        nutrientFlag("sugar", "High in sugar"),
        bands({ sugar: { band: "medium", hasValue: true } }),
      ),
    ).toBe(false);
  });

  /**
   * The colour-inverting case, and the reason this is a health defect rather
   * than a cosmetic one: a 700 g portion at 4 g sugar/100 g clears the FSA
   * per-portion line (700 > 100 && 28 > 27) so the server warns, while per-100
   * 4 <= `FSA_FOOD.sugar.low` 5 bands LOW. Dropping the badge leaves a green
   * check dot and a "LOW" pill standing exactly where the red warning was.
   */
  it("is FALSE when a warn badge says HIGH and the panel bands LOW", () => {
    expect(
      isBandedByPanel(
        nutrientFlag("sugar", "High in sugar"),
        bands({ sugar: { band: "low", hasValue: true } }),
      ),
    ).toBe(false);
  });

  /**
   * The other half of the rule. An `info`-severity nutrient mention makes no
   * severity claim of its own, so ANY band the panel publishes genuinely
   * supersedes it — the badge is redundant, not weakened.
   *
   * No live emitter produces this shape today: every `high()` nutrient flag
   * ships `severity: "warn"`, and the one `info` nutrient flag
   * ("Contains caffeine") maps to `null` and exits earlier. The branch is
   * implemented and tested anyway so the rule is complete at the table rather
   * than accidentally correct via the single severity that happens to exist.
   */
  it("is true for an INFO-severity badge whenever any band resolves", () => {
    expect(
      isBandedByPanel(
        nutrientFlag("sugar", "Contains sugar", "info"),
        bands({ sugar: { band: "medium", hasValue: true } }),
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

  /**
   * The `unknown` guard on the branch where it is still LOAD-BEARING. On the
   * warn branch it is subsumed — `"unknown" !== "high"` already returns false,
   * so the case above would stay green even if the guard were deleted. The
   * `info` branch accepts any resolved band, so this is the only test that
   * fails if the guard goes.
   */
  it("is FALSE for an `unknown` band even at INFO severity", () => {
    expect(
      isBandedByPanel(
        nutrientFlag("sugar", "Contains sugar", "info"),
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
   *
   * The fixture bands HIGH deliberately. It used to band MEDIUM, which the
   * agreement rule now (correctly) treats as "does not replace the badge" —
   * flipping the expectation to `false` would have kept this file green while
   * DELETING the bridge coverage, because a dead mapping returns `false` too.
   * Only a case that expects `true` can prove the table is alive.
   */
  it("bridges snake_case NutrientKind to camelCase ConcernNutrient", () => {
    expect(
      isBandedByPanel(
        nutrientFlag("saturated_fat", "High in saturated fat"),
        bands({ saturatedFat: { band: "high", hasValue: true } }),
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
        // Agrees — the panel's HIGH row says everything the badge said.
        sugar: { band: "high", hasValue: true },
        // Disagrees. This used to be the case that PROVED the badge was
        // dropped; it now proves the opposite, and it is the whole defect: a
        // LOW band is a green check dot and a "LOW" pill, which cannot stand
        // in for "High in saturated fat".
        saturatedFat: { band: "low", hasValue: true },
        // Sodium has a value nowhere, so the panel cannot judge it.
        sodium: { band: "unknown", hasValue: false },
      }),
    );

    expect(kept.map((f) => f.title)).toEqual([
      "High in saturated fat",
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
