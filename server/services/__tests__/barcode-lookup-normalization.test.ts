import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  lookupBarcode,
  normalizeToPerHundredGrams,
  parseServingGrams,
} from "../barcode-lookup";
import {
  _resetCNFCacheForTesting,
  type NutritionData,
} from "../nutrition-lookup";

// `barcode-lookup` reaches the db module at import time for its lookup cache.
// These are pure-function tests, so stub it rather than requiring Postgres.
vi.mock("../../db", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
        onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  },
}));

/**
 * A fixed nutrient payload so every expectation below differs only by the
 * `servingSize` under test. Values are deliberately un-round so a wrong scaling
 * factor cannot coincidentally produce the right answer.
 */
const BASE = {
  name: "Test Product",
  calories: 250,
  protein: 10,
  carbs: 30,
  fat: 8,
  fiber: 3,
  sugar: 5,
  sodium: 400,
  source: "usda" as const,
};

const withServing = (servingSize: string): NutritionData => ({
  ...BASE,
  servingSize,
});

describe("normalizeToPerHundredGrams", () => {
  // ── Characterisation ────────────────────────────────────────────────
  // These pin the three producers that exist today. They pass both before and
  // after the parser change — that is the point. If one of them ever goes red,
  // a real producer's output has been rescaled.
  describe("current producer shapes are byte-identical to today", () => {
    it("passes a CNF/USDA '100g' payload through unscaled", () => {
      // Both lookupCNF and mapUsdaFoodToNutrition hardcode "100g", so the
      // values are already per-100g and the factor must be exactly 1.
      expect(normalizeToPerHundredGrams(withServing("100g"))).toEqual({
        calories: 250,
        protein: 10,
        carbs: 30,
        fat: 8,
        fiber: 3,
        sugar: 5,
        sodium: 400,
      });
    });

    it("scales an API Ninjas `${n}g` payload by 100/n", () => {
      // API Ninjas emits `${item.serving_size_g}g`; 30 g of the base payload
      // scales up by 100/30.
      expect(normalizeToPerHundredGrams(withServing("30g"))).toEqual({
        calories: 833,
        protein: 33.3,
        carbs: 100,
        fat: 26.7,
        fiber: 10,
        sugar: 16.7,
        sodium: 1333.3,
      });
    });
  });

  // ── The fix ─────────────────────────────────────────────────────────
  describe("discards a serving size it cannot place on a gram basis", () => {
    // Each of these currently yields a confidently-wrong object rather than a
    // refusal. The comment records the factor the old parseFloat path produced.
    it.each([
      [
        "1 serving",
        "parseFloat -> 1, factor 100: every nutrient inflated 100x",
      ],
      ["2 cups", "parseFloat -> 2, factor 50"],
      ["one serving", "parseFloat -> NaN, || 100 -> factor 1, mislabelled"],
      ["", "parseFloat -> NaN, || 100 -> factor 1, mislabelled"],
    ])("returns null for %j (%s)", (servingSize) => {
      expect(normalizeToPerHundredGrams(withServing(servingSize))).toBeNull();
    });

    it("returns null for a zero-gram serving rather than dividing by it", () => {
      // `|| 100` swallowed a legitimate 0 and normalized at factor 1; a bare
      // null-check would let 0 through and divide to Infinity.
      expect(normalizeToPerHundredGrams(withServing("0g"))).toBeNull();
    });
  });

  describe("reads the gram figure out of a compound serving string", () => {
    it("uses the parenthesised grams, not the leading count", () => {
      // "1 cup (240g)" is the worst case for the old parser: parseFloat took
      // the leading 1 and scaled by 100 when the correct factor is 100/240.
      expect(normalizeToPerHundredGrams(withServing("1 cup (240g)"))).toEqual({
        calories: 104,
        protein: 4.2,
        carbs: 12.5,
        fat: 3.3,
        fiber: 1.3,
        sugar: 2.1,
        sodium: 166.7,
      });
    });
  });
});

// ── parseServingGrams — the unit match must be a whole word ────────────
// `normalizeToPerHundredGrams` calls this, but two more call sites
// (`offLabelGrams`, `servingGrams` in `lookupBarcode`) feed it live OFF
// `serving_size` text directly, so it needs its own direct coverage.
//
// Mutation check (performed, not just claimed — P2-2026-08-10). The fix has
// THREE independent levers in `barcode-lookup.ts` — `SERVING_UNIT`'s trailing
// `\b`, `SERVING_UNIT`'s vocabulary, and `SERVING_FIGURE`'s digit group —
// plus a FOURTH mutation that is not a revert but the plausible future
// "simplification" of the fourth. Each was applied alone against the regex
// text (not by editing the source file) and every case below re-evaluated.
// Blocks named, not counted, so the claim survives adding a case to one:
//   - Reverting ONLY the trailing `\b` (keeping the full vocabulary) turns
//     "rejects a unit that is only a prefix" and the "gr"/"grain" test red —
//     "g" alone is always in the vocabulary, so without the boundary it still
//     matches the first letter of "gallon"/"glasses"/"gummies"/"grande"/
//     "gr"/"grain".
//   - Reverting ONLY the vocabulary (back to bare `g|ml`, keeping `\b`) turns
//     "spelled-out unit", "informal spellings" and "non-English gram
//     spellings" red in full, plus the one millilitre case in "comma decimal"
//     — none of those units is "g" or "ml" verbatim, so they depend on the
//     added alternatives, not the anchor.
//   - Reverting ONLY the figure group (back to the dot-only `\d+\.?\d*`)
//     turns 5 of the 6 "comma decimal" cases red — and turns them red by
//     returning a WRONG NUMBER rather than null: 5, 5, 50, 0, 5. That is the
//     point of the block: the failure mode is a plausible value, not a
//     refusal. The 6th ("1,000 g") is insensitive to this lever BY DESIGN —
//     it pins a value the fix deliberately leaves unchanged.
//   - "1,000 g" has its own discriminating mutation, and it is the one a
//     future editor is most likely to try: "simplifying" the figure group to
//     `\d+[.,]?\d*`. That turns ONLY that case red, and again by returning a
//     number — 1 g for a figure the current code refuses. It is the sole
//     guard on the `{1,2}` bound, so do not delete it as redundant.
// The characterisation block and "30 mg" are insensitive to all four
// mutations and stay green under every one.
describe("parseServingGrams", () => {
  // ── Characterisation ────────────────────────────────────────────────
  // Pins every real producer's shape. These pass both before and after the
  // anchor change below — if one goes red, a real producer's output changed.
  describe("current producer shapes are byte-identical to today", () => {
    it.each([
      ["100g", 100],
      ["30g", 30],
      ["355 ml", 355],
      ["1 cup (240g)", 240],
    ])("parses %j as %j", (input, expected) => {
      expect(parseServingGrams(input)).toBe(expected);
    });

    it("returns null for a string with no metric unit", () => {
      expect(parseServingGrams("1 bottle")).toBeNull();
      expect(parseServingGrams("")).toBeNull();
    });
  });

  // ── The fix ─────────────────────────────────────────────────────────
  // The old alternation `(?:g|ml)` had no word boundary, so it matched the
  // first two letters of any unit merely BEGINNING with `g` or `ml`.
  describe("rejects a unit that is only a prefix of a longer word", () => {
    it.each(["1 gallon", "2 glasses", "3 gummies", "1 grande"])(
      "returns null for %j",
      (input) => {
        expect(parseServingGrams(input)).toBeNull();
      },
    );
  });

  describe("reads a spelled-out unit", () => {
    it.each([
      ["100 grams", 100],
      ["250 millilitres", 250],
      ["250 milliliters", 250],
    ])("parses %j as %j", (input, expected) => {
      expect(parseServingGrams(input)).toBe(expected);
    });
  });

  // ── Predecessor-accepted informal spellings, kept on purpose ───────────
  // This function parses OFF's crowdsourced free-text `serving_size` field —
  // not OCR'd printed labels like `shared/lib/label-serving.ts` — where
  // informal abbreviations ("gm", "gms") and non-US spellings ("gramme(s)")
  // are common. The old prefix-match accepted all of these; narrowing them
  // away would be the exact "replacement must accept predecessor inputs"
  // mistake documented in
  // docs/solutions/conventions/replacement-must-accept-predecessor-inputs-2026-07-30.md.
  describe("still accepts informal spellings the old prefix-match happened to get right", () => {
    it.each([
      ["30 grammes", 30],
      ["1 gramme", 1],
      ["30 gm", 30],
      ["500 gms", 500],
      ["250 mls", 250],
    ])("parses %j as %j", (input, expected) => {
      expect(parseServingGrams(input)).toBe(expected);
    });
  });

  // ── Predecessor-accepted non-English gram spellings ────────────────────
  // Same principle as the block above, on the half the first version of this
  // fix missed. OFF is French-founded and internationally crowdsourced, so a
  // `serving_size` written in the contributor's own language is routine. The
  // old unanchored `(?:g|ml)` accepted every one of these (all parsed as 30)
  // via the bare-`g` prefix match; the first anchored vocabulary returned
  // null for all six. Verified against origin/main before being pinned here.
  describe("still accepts non-English gram spellings the old prefix-match happened to get right", () => {
    it.each([
      ["30 grammi", 30], // Italian
      ["30 gramos", 30], // Spanish
      ["30 gramas", 30], // Portuguese
      ["30 gramm", 30], // German
      ["30 grs", 30],
      ["30 grm", 30],
    ])("parses %j as %j", (input, expected) => {
      expect(parseServingGrams(input)).toBe(expected);
    });
  });

  // ── Comma decimal separator ───────────────────────────────────────────
  // A comma decimal is the norm across continental Europe, so adding the
  // European unit spellings above newly REACHES this pre-existing digit-side
  // hole: `\d+\.?\d*` understands only `.`, so on "12,5 g" the engine skipped
  // the "12," and matched the trailing "5" — returning 5, a plausible,
  // sub-MAX_PLAUSIBLE_SERVING_GRAMS value that ships as trusted. Closed in
  // the same change that made it reachable.
  describe("reads a comma decimal separator", () => {
    it.each([
      ["12,5 g", 12.5],
      ["12,5 millilitres", 12.5],
      ["12,50 g", 12.5],
      ["100,0 g", 100],
      ["1 cup (12,5 g)", 12.5],
    ])("parses %j as %j", (input, expected) => {
      expect(parseServingGrams(input)).toBe(expected);
    });

    // A comma before exactly three digits is genuinely ambiguous — EU decimal
    // ("1,000" = 1) vs US thousands ("1,000" = 1000) — and guessing either way
    // is wrong half the time. The `,\d{1,2}` bound makes the figure group
    // decline to consume it; the engine falls through to the trailing "000",
    // yielding 0 — which every caller already treats as "no serving data"
    // (`!(grams > 0)`, `offLabelGrams <= 0`, `servingGrams > 0`). Unchanged
    // from both predecessors, and the case that discriminates this figure
    // group from the simpler `\d+[.,]?\d*`: THAT one reads "1,000 g" as 1 g,
    // newly ACCEPTING a 1000x-wrong basis below MAX_PLAUSIBLE_SERVING_GRAMS
    // where today's code rejects it.
    it("does not guess at an ambiguous comma-then-three-digits figure", () => {
      expect(parseServingGrams("1,000 g")).toBe(0);
    });
  });

  // ── A deliberate narrowing, not an accident ────────────────────────────
  // Bare "gr" is NOT accepted: on its own it is the symbol for the apothecary
  // "grain", a genuinely different unit of mass, so accepting it would
  // silently misread a grain-labelled serving as grams. Unit symbols do not
  // pluralize, which is why "grs"/"grm" above are NOT grain abbreviations and
  // are safe to accept — pinned together here so the pair does not read as an
  // inconsistency a future editor "fixes" by admitting bare "gr". Every other
  // spelling the old prefix-match happened to accept is preserved above.
  it('rejects "gr"/"grain" — the apothecary unit, not a gram abbreviation', () => {
    expect(parseServingGrams("30 gr")).toBeNull();
    expect(parseServingGrams("1 grain")).toBeNull();
    expect(parseServingGrams("30 grains")).toBeNull();
  });

  it("does not misread a milligram figure as grams (unaffected by this fix)", () => {
    // True before and after: neither the old nor the new alternation
    // includes `mg`. Pinned so a future vocabulary change cannot regress it.
    expect(parseServingGrams("30 mg")).toBeNull();
  });
});

// ── Call-site behaviour ───────────────────────────────────────────────
// The unit tests above prove the helper refuses. These prove the refusal is
// acted on: a secondary that cannot be normalized must be discarded, not fed
// to reconcilePer100g, which can otherwise gap-fill or replace the primary.

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function setupFetchMock(
  urlResponses: Record<
    string,
    () => Promise<{ ok: boolean; json: () => Promise<unknown> }>
  >,
) {
  mockFetch.mockImplementation((url: string) => {
    for (const [pattern, responseFn] of Object.entries(urlResponses)) {
      if (url.includes(pattern)) return responseFn();
    }
    return Promise.resolve({ ok: false, json: async () => ({}) });
  });
}

const emptyCNF = () => Promise.resolve({ ok: true, json: async () => [] });
const emptyUSDASearch = () =>
  Promise.resolve({ ok: true, json: async () => ({ foods: [] }) });

describe("lookupBarcode — a secondary with no gram basis is discarded", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    _resetCNFCacheForTesting();
    // API Ninjas is the only producer whose serving size is data-driven, so it
    // is the one that can reach the discard path. It is env-gated.
    vi.stubEnv("API_NINJAS_KEY", "test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("leaves the OFF primary unchanged and un-gap-filled", async () => {
    // The OFF primary deliberately omits fiber and sugar. API Ninjas returns a
    // calorie figure close enough to "agree" (500 vs 400 is inside the [0.5,
    // 2.0] ratio window) and DOES carry fiber/sugar — so if its zero-gram
    // serving were normalized instead of discarded, reconcilePer100g would
    // gap-fill both fields and stamp the source "+verified".
    setupFetchMock({
      "openfoodfacts.org": () =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            status: 1,
            product: {
              product_name: "Basis Test Snack",
              brands: "TestBrand",
              nutriments: {
                "energy-kcal_100g": 400,
                proteins_100g: 5,
                carbohydrates_100g: 60,
                fat_100g: 10,
              },
            },
          }),
        }),
      "food/?lang=en": emptyCNF,
      "food/?lang=fr": emptyCNF,
      "fdc/v1/foods/search": emptyUSDASearch,
      "api-ninjas.com": () =>
        Promise.resolve({
          ok: true,
          json: async () => [
            {
              name: "basis test snack",
              calories: 500,
              protein_g: 6,
              carbohydrates_total_g: 62,
              fat_total_g: 11,
              fiber_g: 7,
              sugar_g: 12,
              sodium_mg: 300,
              // A zero-gram serving cannot establish a basis. The old
              // `parseFloat(...) || 100` read this as 100 g and normalized at
              // factor 1, silently treating per-serving values as per-100g.
              serving_size_g: 0,
            },
          ],
        }),
    });

    const result = await lookupBarcode("012345678905");

    expect(result).not.toBeNull();
    // The primary survives byte-identically.
    expect(result!.per100g.calories).toBe(400);
    expect(result!.per100g.protein).toBe(5);
    expect(result!.per100g.carbs).toBe(60);
    expect(result!.per100g.fat).toBe(10);
    // No gap-fill from the discarded secondary.
    expect(result!.per100g.fiber).toBeUndefined();
    expect(result!.per100g.sugar).toBeUndefined();
    // A discarded secondary must be indistinguishable from an absent one, so
    // the source label keeps its plain form — no "+verified".
    expect(result!.source).toBe("openfoodfacts");
  });
});
