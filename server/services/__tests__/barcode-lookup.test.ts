import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  lookupBarcode,
  scaleNutrients,
  extractOffUniversalData,
} from "../barcode-lookup";
import { _resetCNFCacheForTesting } from "../nutrition-lookup";

// Mock the db module so the cache functions don't hit a real database
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

// URL-aware fetch mock
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

/**
 * Helper: configure mockFetch to return different responses based on URL.
 * Each URL pattern can be mapped to a response.
 */
function setupFetchMock(
  urlResponses: Record<
    string,
    () => Promise<{ ok: boolean; json: () => Promise<unknown> }>
  >,
) {
  mockFetch.mockImplementation((url: string) => {
    for (const [pattern, responseFn] of Object.entries(urlResponses)) {
      if (url.includes(pattern)) {
        return responseFn();
      }
    }
    // Default: return a failed response for unmatched URLs
    return Promise.resolve({
      ok: false,
      json: async () => ({}),
    });
  });
}

/** Standard CNF mock responses — empty food lists so CNF doesn't interfere */
const emptyCNFEN = () => Promise.resolve({ ok: true, json: async () => [] });
const emptyCNFFR = () => Promise.resolve({ ok: true, json: async () => [] });

/** USDA generic-food search miss (no branded/UPC lookup involved here) */
const emptyUSDASearch = () =>
  Promise.resolve({ ok: true, json: async () => ({ foods: [] }) });

describe("lookupBarcode — isServingDataTrusted regression (P2-2026-07-14)", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    _resetCNFCacheForTesting();
  });

  it("trusts a real serving size even when CNF/USDA cross-validation misses (Cherry Coke case)", async () => {
    // OFF has a real serving size ("355 ml") and CNF/USDA have no match at all
    // (a total miss counts as "cross-validation failed" — `source` never gets
    // the "+verified" suffix). The bug: `isServingDataTrusted` used to be
    // derived from `source.includes("verified")`, an orthogonal signal from
    // whether real serving data existed and was used to scale the values.
    setupFetchMock({
      "openfoodfacts.org": () =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            status: 1,
            product: {
              product_name: "Cherry Coke",
              brands: "Coca-Cola",
              serving_size: "355 ml",
              nutriments: {
                "energy-kcal_100g": 23,
                proteins_100g: 0,
                carbohydrates_100g: 5.8,
                fat_100g: 0,
                sugar_100g: 5.8,
                sodium_100g: 0.005,
              },
            },
          }),
        }),
      "food/?lang=en": emptyCNFEN,
      "food/?lang=fr": emptyCNFFR,
      "fdc/v1/foods/search": emptyUSDASearch,
    });

    const result = await lookupBarcode("049000028911");
    expect(result).not.toBeNull();
    // No secondary source at all → no "+verified" suffix on the source label.
    expect(result!.source).toBe("openfoodfacts");
    // Serving size (355ml) is plausible — no correction applied.
    expect(result!.servingInfo.wasCorrected).toBe(false);
    expect(result!.servingInfo.grams).toBe(355);
    // 23 kcal/100g scaled to 355g/ml ≈ 82 kcal — matches the real-world report.
    expect(result!.perServing.calories).toBe(82);
    // The core regression assertion: real serving data was used to scale the
    // values, so this must be trusted — regardless of cross-validation status.
    expect(result!.isServingDataTrusted).toBe(true);
  });

  it("does not trust serving data when no serving size exists at all", async () => {
    // No serving_size and no quantity field on the OFF product — the
    // legitimate "we truly don't know the serving size" case. This must
    // still show isServingDataTrusted: false (per-100g/Check-package
    // treatment is correct here).
    setupFetchMock({
      "openfoodfacts.org": () =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            status: 1,
            product: {
              product_name: "Mystery Snack",
              brands: "GenericBrand",
              // No serving_size, no quantity.
              nutriments: {
                "energy-kcal_100g": 400,
                proteins_100g: 5,
                carbohydrates_100g: 60,
                fat_100g: 10,
              },
            },
          }),
        }),
      "food/?lang=en": emptyCNFEN,
      "food/?lang=fr": emptyCNFFR,
      "fdc/v1/foods/search": emptyUSDASearch,
    });

    const result = await lookupBarcode("012345678905");
    expect(result).not.toBeNull();
    expect(result!.servingInfo.wasCorrected).toBe(false);
    // No serving data was ever parsed — falls back to displaying per-100g.
    expect(result!.servingInfo.grams).toBe(100);
    expect(result!.isServingDataTrusted).toBe(false);
  });

  it("does not trust a corrected (estimated) serving size, even though real serving data existed", async () => {
    // Discriminates `hasServingData && !wasCorrected` from a naive
    // `hasServingData`-only (or `!wasCorrected`-only) derivation: real
    // serving data WAS present (a parsed "236g"), but it was implausible
    // (whole-package weight) and got corrected to an estimate — that
    // estimate must NOT be trusted as a real per-serving value.
    setupFetchMock({
      "openfoodfacts.org": () =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            status: 1,
            product: {
              product_name: "Hot Chocolate K-Cup Pods",
              serving_size: "236g", // whole box — implausible as one serving
              nutriments: {
                "energy-kcal_100g": 400,
                proteins_100g: 5,
                carbohydrates_100g: 80,
                fat_100g: 5,
              },
            },
          }),
        }),
      "food/?lang=en": emptyCNFEN,
      "food/?lang=fr": emptyCNFFR,
      "fdc/v1/foods/search": emptyUSDASearch,
    });

    const result = await lookupBarcode("0663447217174");
    expect(result).not.toBeNull();
    // 236g at 400 kcal/100g = 944 kcal — exceeds the plausibility threshold.
    expect(result!.servingInfo.wasCorrected).toBe(true);
    expect(result!.isServingDataTrusted).toBe(false);
  });

  it("trusts a real serving size when cross-validation disagrees and swaps to the secondary source", async () => {
    // OFF's per-100g is wildly wrong (50 kcal, should be ~387) — reconcilePer100g's
    // ratio check (0.13, outside [0.5, 2.0]) swaps to CNF's value entirely. This
    // exercises the "disagree and replace" branch of reconcilePer100g (distinct
    // from the "no secondary at all" branch the other cases in this file
    // exercise) with a real, uncorrected serving size — isServingDataTrusted
    // must still be true, and `source` ("cnf") never contains "verified" either.
    setupFetchMock({
      "openfoodfacts.org": () =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            status: 1,
            product: {
              product_name: "Sugar",
              serving_size: "40g",
              nutriments: {
                "energy-kcal_100g": 50, // wrong — CNF has the real value
                proteins_100g: 0,
                carbohydrates_100g: 12,
                fat_100g: 0,
              },
            },
          }),
        }),
      "food/?lang=en": () =>
        Promise.resolve({
          ok: true,
          json: async () => [
            { food_code: 4318, food_description: "Sweets, sugars, granulated" },
          ],
        }),
      "food/?lang=fr": () =>
        Promise.resolve({
          ok: true,
          json: async () => [
            {
              food_code: 4318,
              food_description: "Confiseries, sucre, granulé",
            },
          ],
        }),
      nutrientamount: () =>
        Promise.resolve({
          ok: true,
          json: async () => [
            {
              food_code: 4318,
              nutrient_value: 387,
              nutrient_name_id: 208,
              nutrient_web_name: "Energy (kcal)",
            },
          ],
        }),
    });

    const result = await lookupBarcode("999888777");
    expect(result).not.toBeNull();
    // CNF wins on disagreement — source becomes "cnf", never "+verified".
    expect(result!.source).toBe("cnf");
    expect(result!.per100g.calories).toBe(387);
    expect(result!.servingInfo.wasCorrected).toBe(false);
    expect(result!.servingInfo.grams).toBe(40);
    expect(result!.isServingDataTrusted).toBe(true);
  });

  it("does not trust a `quantity`-only serving size, even when it falls under the correction thresholds (P3-2026-07-16)", async () => {
    // OFF has NO `serving_size` (the real per-serving label) but DOES have a
    // `quantity` (package net weight — here "340g", a plausible-looking juice
    // carton weight that is well under both MAX_PLAUSIBLE_SERVING_GRAMS (500)
    // and, at 45 kcal/100g, MAX_PLAUSIBLE_SERVING_CALORIES (800) too). A
    // pre-fix bug treated this as a trusted, correctly-scaled 340g serving.
    // The fix: `quantity` is no longer used for serving-size parsing at all,
    // so this must behave identically to the no-serving-data case — fall
    // back to per-100g values, uncorrected, untrusted.
    setupFetchMock({
      "openfoodfacts.org": () =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            status: 1,
            product: {
              product_name: "Orange Juice Carton",
              brands: "GenericBrand",
              quantity: "340g", // whole-carton net weight, NOT a serving size
              nutriments: {
                "energy-kcal_100g": 45,
                proteins_100g: 0.7,
                carbohydrates_100g: 10,
                fat_100g: 0.2,
              },
            },
          }),
        }),
      "food/?lang=en": emptyCNFEN,
      "food/?lang=fr": emptyCNFFR,
      "fdc/v1/foods/search": emptyUSDASearch,
    });

    const result = await lookupBarcode("040000000004");
    expect(result).not.toBeNull();
    // No correction fires — there was never a servingGrams value to correct;
    // `quantity` is excluded from parsing entirely, so this is NOT the
    // "corrected estimate" path, it's the "no serving data" path.
    expect(result!.servingInfo.wasCorrected).toBe(false);
    expect(result!.servingInfo.grams).toBe(100);
    expect(result!.perServing.calories).toBe(result!.per100g.calories);
    expect(result!.isServingDataTrusted).toBe(false);
  });

  it("does not run the whole-package correction on an over-threshold `quantity`-only value either (P3-2026-07-16)", async () => {
    // Before the fix, a `quantity` this large (1000g) WOULD have reached the
    // Step 5 correction block via the `rawServing` fallback, producing
    // `wasCorrected: true` and an estimated-serving display like
    // "~15g (estimated)". After the fix, `quantity` never feeds
    // `rawServing`/`servingGrams` at all, so this must land on the plain
    // "no serving data" path instead — `wasCorrected: false`,
    // `displayLabel: "100g"` — not the correction path with a different
    // (also-untrusted) result.
    setupFetchMock({
      "openfoodfacts.org": () =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            status: 1,
            product: {
              product_name: "Family-Size Trail Mix",
              brands: "GenericBrand",
              quantity: "1000g", // whole-bag net weight, well over both thresholds
              nutriments: {
                "energy-kcal_100g": 480,
                proteins_100g: 12,
                carbohydrates_100g: 45,
                fat_100g: 28,
              },
            },
          }),
        }),
      "food/?lang=en": emptyCNFEN,
      "food/?lang=fr": emptyCNFFR,
      "fdc/v1/foods/search": emptyUSDASearch,
    });

    const result = await lookupBarcode("040000000011");
    expect(result).not.toBeNull();
    expect(result!.servingInfo.wasCorrected).toBe(false);
    expect(result!.servingInfo.correctionReason).toBeUndefined();
    expect(result!.servingInfo.displayLabel).toBe("100g");
    expect(result!.servingInfo.grams).toBe(100);
    expect(result!.isServingDataTrusted).toBe(false);
  });
});

describe("lookupBarcode — self-consistent OFF label vs name-matched secondary (McSweeney's case, 2026-07-17)", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    _resetCNFCacheForTesting();
  });

  it("keeps OFF's calories when its per-serving, per-100g, and serving size corroborate each other, even if a CNF name-match disagrees >2x", async () => {
    // Real-world case: McSweeney's Pepperoni & Cheddar Cheese Sticks
    // (barcode 0778918011332). OFF has the package data exactly right and
    // internally consistent: 344.4 kcal/100g × 90g/100 = 310 kcal/serving,
    // matching energy-kcal_serving AND the physical package. But the CNF
    // name-search (via the "cheese snack" category term) fuzzy-matched a
    // generic cheese product at ~109 kcal/100g — a DIFFERENT food. The old
    // preferSecondaryOnDiscrepancy policy replaced OFF's correct 344 with
    // 109, displaying 98 kcal for a 310-kcal serving. A label that agrees
    // with itself must not be overridden by a fuzzy name match.
    setupFetchMock({
      "openfoodfacts.org": () =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            status: 1,
            product: {
              product_name: "Original Pep'n Ched",
              product_name_en: "Pepperoni & Cheddar Cheese Sticks",
              brands: "McSweeney's",
              serving_size: "90 g",
              serving_quantity: 90,
              categories_tags: ["en:cheese-snack"],
              nutriments: {
                "energy-kcal_100g": 344.444444444444,
                "energy-kcal_serving": 310,
                proteins_100g: 21.1111111111111,
                carbohydrates_100g: 1.11111111111111,
                fat_100g: 28.8888888888889,
                sodium_100g: 0.9,
              },
            },
          }),
        }),
      "food/?lang=en": () =>
        Promise.resolve({
          ok: true,
          json: async () => [
            {
              food_code: 130,
              food_description: "Cheese snack, processed cheese product",
            },
          ],
        }),
      "food/?lang=fr": emptyCNFFR,
      nutrientamount: () =>
        Promise.resolve({
          ok: true,
          json: async () => [
            {
              food_code: 130,
              nutrient_value: 109,
              nutrient_name_id: 208,
              nutrient_web_name: "Energy (kcal)",
            },
          ],
        }),
    });

    const result = await lookupBarcode("0778918011332");
    expect(result).not.toBeNull();
    // OFF wins: the self-consistent label data is kept, not the CNF generic.
    // (per100g passes through OFF's raw float unrounded — only perServing,
    // the displayed value, is rounded.)
    expect(result!.per100g.calories).toBeCloseTo(344.4, 1);
    expect(result!.perServing.calories).toBe(310);
    expect(result!.servingInfo.grams).toBe(90);
    expect(result!.servingInfo.wasCorrected).toBe(false);
    expect(result!.isServingDataTrusted).toBe(true);
    // A rejected secondary is neither the source nor a verifier — but the
    // self-consistent rejection IS distinguishable from "no secondary found"
    // (todo P3-2026-07-17-off-self-consistency-gate-refinements, AC1).
    expect(result!.source).toBe("openfoodfacts+self-consistent");
  });

  it("treats deviation just under the 15% tolerance as self-consistent (label-rounding noise)", async () => {
    // per100g 344.444 × 90g/100 = 310.0 derived; energy-kcal_serving 264 →
    // |310 − 264| / 310 ≈ 14.8% (relative check delegated to `valuesMatch`,
    // whose denominator is max(derived, label) — see AC4) — inside the
    // tolerance. Pins the cutoff from the other side of the "just over" test
    // below (264/263 bracket the ≈263.5 boundary tightly): tightening it to
    // e.g. 0.05 (silently reverting real-world label-rounded entries to the
    // old name-match replacement bug) must fail this test.
    setupFetchMock({
      "openfoodfacts.org": () =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            status: 1,
            product: {
              product_name: "Original Pep'n Ched",
              serving_size: "90 g",
              categories_tags: ["en:cheese-snack"],
              nutriments: {
                "energy-kcal_100g": 344.444444444444,
                "energy-kcal_serving": 264,
                proteins_100g: 21.1,
                carbohydrates_100g: 1.1,
                fat_100g: 28.9,
              },
            },
          }),
        }),
      "food/?lang=en": () =>
        Promise.resolve({
          ok: true,
          json: async () => [
            {
              food_code: 130,
              food_description: "Cheese snack, processed cheese product",
            },
          ],
        }),
      "food/?lang=fr": emptyCNFFR,
      nutrientamount: () =>
        Promise.resolve({
          ok: true,
          json: async () => [
            {
              food_code: 130,
              nutrient_value: 109,
              nutrient_name_id: 208,
              nutrient_web_name: "Energy (kcal)",
            },
          ],
        }),
    });

    const result = await lookupBarcode("0778918011332");
    expect(result).not.toBeNull();
    expect(result!.per100g.calories).toBeCloseTo(344.4, 1);
    expect(result!.source).toBe("openfoodfacts+self-consistent");
  });

  it("treats deviation just over the 15% tolerance as NOT self-consistent — secondary swap stays active", async () => {
    // Same fixture but energy-kcal_serving 263 → |310 − 263| / 310 ≈ 15.2%
    // (relative check delegated to `valuesMatch`, denominator max(310, 263) =
    // 310 — see AC4) and |310 − 263| = 47 exceeds the 5 kcal absolute floor
    // (AC2) too — outside both, so no shield: the >2x discrepancy path
    // replaces with CNF as before. Pins the cutoff from the other side
    // (loosening to e.g. 0.5 must fail this test).
    setupFetchMock({
      "openfoodfacts.org": () =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            status: 1,
            product: {
              product_name: "Original Pep'n Ched",
              serving_size: "90 g",
              categories_tags: ["en:cheese-snack"],
              nutriments: {
                "energy-kcal_100g": 344.444444444444,
                "energy-kcal_serving": 263,
                proteins_100g: 21.1,
                carbohydrates_100g: 1.1,
                fat_100g: 28.9,
              },
            },
          }),
        }),
      "food/?lang=en": () =>
        Promise.resolve({
          ok: true,
          json: async () => [
            {
              food_code: 130,
              food_description: "Cheese snack, processed cheese product",
            },
          ],
        }),
      "food/?lang=fr": emptyCNFFR,
      nutrientamount: () =>
        Promise.resolve({
          ok: true,
          json: async () => [
            {
              food_code: 130,
              nutrient_value: 109,
              nutrient_name_id: 208,
              nutrient_web_name: "Energy (kcal)",
            },
          ],
        }),
    });

    const result = await lookupBarcode("0778918011332");
    expect(result).not.toBeNull();
    expect(result!.per100g.calories).toBe(109);
    expect(result!.source).toBe("cnf");
  });

  it("shields a low-calorie label past the 15% relative tolerance via the absolute floor (~20 kcal/serving, PR review follow-up)", async () => {
    // FDA/Codex nearest-5-kcal label rounding can push a genuinely correct
    // low-calorie label past 15% relative deviation even though the absolute
    // gap is just rounding noise. Here 96 kcal/100g × 25g/100 = 24 derived vs.
    // a 20 kcal/serving label: |24-20|/24 ≈ 16.7% (the `valuesMatch` relative
    // check, denominator max(24,20)=24, fails alone) but |24-20| = 4 kcal is
    // within the 5 kcal absolute floor — the
    // label stays self-consistent and the disagreeing CNF name-match
    // (200 kcal/100g, ratio 96/200 = 0.48, out of [0.5, 2.0]) is rejected.
    setupFetchMock({
      "openfoodfacts.org": () =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            status: 1,
            product: {
              product_name: "Trail Mix Bar",
              serving_size: "25g",
              nutriments: {
                "energy-kcal_100g": 96,
                "energy-kcal_serving": 20,
                proteins_100g: 2,
                carbohydrates_100g: 14,
                fat_100g: 3,
              },
            },
          }),
        }),
      "food/?lang=en": () =>
        Promise.resolve({
          ok: true,
          json: async () => [
            { food_code: 777, food_description: "Trail mix, generic" },
          ],
        }),
      "food/?lang=fr": emptyCNFFR,
      nutrientamount: () =>
        Promise.resolve({
          ok: true,
          json: async () => [
            {
              food_code: 777,
              nutrient_value: 200,
              nutrient_name_id: 208,
              nutrient_web_name: "Energy (kcal)",
            },
          ],
        }),
    });

    const result = await lookupBarcode("111222333");
    expect(result).not.toBeNull();
    expect(result!.per100g.calories).toBe(96);
    expect(result!.source).toBe("openfoodfacts+self-consistent");
  });

  it("does NOT extend the absolute floor past ~5 kcal — a bigger low-calorie gap still swaps to the secondary", async () => {
    // Same shape as the floor-rescue test above, but the derived value is 26
    // (104 kcal/100g × 25g/100) vs. the 20 kcal/serving label: |26-20| = 6
    // kcal exceeds the 5 kcal absolute floor, and the `valuesMatch` relative
    // check (denominator max(26,20)=26) is 6/26 ≈ 23.1% — also over 15% — so
    // this is a real discrepancy, not rounding noise: the secondary rescue
    // must stay active.
    setupFetchMock({
      "openfoodfacts.org": () =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            status: 1,
            product: {
              product_name: "Trail Mix Bar",
              serving_size: "25g",
              nutriments: {
                "energy-kcal_100g": 104,
                "energy-kcal_serving": 20,
                proteins_100g: 2,
                carbohydrates_100g: 14,
                fat_100g: 3,
              },
            },
          }),
        }),
      "food/?lang=en": () =>
        Promise.resolve({
          ok: true,
          json: async () => [
            { food_code: 778, food_description: "Trail mix, generic" },
          ],
        }),
      "food/?lang=fr": emptyCNFFR,
      nutrientamount: () =>
        Promise.resolve({
          ok: true,
          json: async () => [
            {
              food_code: 778,
              nutrient_value: 250,
              nutrient_name_id: 208,
              nutrient_web_name: "Energy (kcal)",
            },
          ],
        }),
    });

    const result = await lookupBarcode("111222444");
    expect(result).not.toBeNull();
    expect(result!.per100g.calories).toBe(250);
    expect(result!.source).toBe("cnf");
  });

  it("treats an explicitly zero-calorie product as self-consistent — CNF name-match must not invent calories for water", async () => {
    // Real-world case (prod cache sweep 2026-07-17, barcode 0060383653293):
    // PC Natural Spring Water — OFF correctly has 0 kcal in BOTH per-100g and
    // per-serving fields with a real "500g" serving size. The old gate required
    // calories > 0 to claim self-consistency, so reconcilePer100g's
    // primaryMissing arm (pc === 0) replaced water's true zero with a CNF
    // name-match (~51 kcal/100g × 5 = 257 kcal of phantom food). Explicit
    // 0-and-0 agreement IS corroboration — water must stay 0.
    setupFetchMock({
      "openfoodfacts.org": () =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            status: 1,
            product: {
              product_name: "Natural Spring Water",
              brands: "PC",
              serving_size: "500g",
              nutriments: {
                "energy-kcal_100g": 0,
                "energy-kcal_serving": 0,
                proteins_100g: 0,
                carbohydrates_100g: 0,
                fat_100g: 0,
              },
            },
          }),
        }),
      "food/?lang=en": () =>
        Promise.resolve({
          ok: true,
          json: async () => [
            { food_code: 555, food_description: "Water, spring, bottled" },
          ],
        }),
      "food/?lang=fr": emptyCNFFR,
      nutrientamount: () =>
        Promise.resolve({
          ok: true,
          json: async () => [
            {
              food_code: 555,
              nutrient_value: 51,
              nutrient_name_id: 208,
              nutrient_web_name: "Energy (kcal)",
            },
          ],
        }),
    });

    const result = await lookupBarcode("0060383653293");
    expect(result).not.toBeNull();
    expect(result!.per100g.calories).toBe(0);
    expect(result!.perServing.calories).toBe(0);
    expect(result!.source).toBe("openfoodfacts");
  });

  it("does NOT shield a zero per-100g when per-serving is nonzero (unfilled entry) — secondary rescue stays active", async () => {
    // 0-kcal per-100g with a NONZERO per-serving is contradiction, not
    // corroboration — likely an unfilled/partial OFF entry. The secondary
    // replacement (primaryMissing arm) must still rescue it.
    setupFetchMock({
      "openfoodfacts.org": () =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            status: 1,
            product: {
              product_name: "Sugar",
              serving_size: "40g",
              nutriments: {
                "energy-kcal_100g": 0, // unfilled
                "energy-kcal_serving": 155,
                proteins_100g: 0,
                carbohydrates_100g: 12,
                fat_100g: 0,
              },
            },
          }),
        }),
      "food/?lang=en": () =>
        Promise.resolve({
          ok: true,
          json: async () => [
            { food_code: 4318, food_description: "Sweets, sugars, granulated" },
          ],
        }),
      "food/?lang=fr": emptyCNFFR,
      nutrientamount: () =>
        Promise.resolve({
          ok: true,
          json: async () => [
            {
              food_code: 4318,
              nutrient_value: 387,
              nutrient_name_id: 208,
              nutrient_web_name: "Energy (kcal)",
            },
          ],
        }),
    });

    const result = await lookupBarcode("999888777");
    expect(result).not.toBeNull();
    expect(result!.per100g.calories).toBe(387);
    expect(result!.source).toBe("cnf");
  });

  it("shields an explicit 0-and-0 product even when serving_size is unparseable — zero-agreement needs no grams (PR #656 review)", async () => {
    // Same spring-water shape, but serving_size "1 bottle" (no gram/ml amount —
    // parseServingGrams → null). 0 × grams / 100 = 0 for ANY grams, so the
    // zero-corroboration must not sit behind the ratio check's grams guard;
    // otherwise the phantom-calorie bug recurs for every zero-cal product
    // whose label serving isn't metric (US fl-oz labels, "1 bottle", absent).
    setupFetchMock({
      "openfoodfacts.org": () =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            status: 1,
            product: {
              product_name: "Natural Spring Water",
              brands: "PC",
              serving_size: "1 bottle",
              nutriments: {
                "energy-kcal_100g": 0,
                "energy-kcal_serving": 0,
                proteins_100g: 0,
                carbohydrates_100g: 0,
                fat_100g: 0,
              },
            },
          }),
        }),
      "food/?lang=en": () =>
        Promise.resolve({
          ok: true,
          json: async () => [
            { food_code: 555, food_description: "Water, spring, bottled" },
          ],
        }),
      "food/?lang=fr": emptyCNFFR,
      nutrientamount: () =>
        Promise.resolve({
          ok: true,
          json: async () => [
            {
              food_code: 555,
              nutrient_value: 51,
              nutrient_name_id: 208,
              nutrient_web_name: "Energy (kcal)",
            },
          ],
        }),
    });

    const result = await lookupBarcode("0060383653293");
    expect(result).not.toBeNull();
    expect(result!.per100g.calories).toBe(0);
    expect(result!.source).toBe("openfoodfacts");
  });

  it("does NOT shield 0-and-0 energy when the entry's own macros say the food has calories — stub rescue stays active (PR #656 review)", async () => {
    // Contributor stub: energy left at explicit 0s but real macros filled in
    // (33 g fat + 22 g carbs ≈ 385 kcal/100g by Atwater). Zero energy only
    // corroborates zero energy when the macros are also ~0 (water, diet soda);
    // here the entry contradicts itself, so the CNF name-match must still
    // replace it instead of caching an impossible 0-kcal/33g-fat row.
    setupFetchMock({
      "openfoodfacts.org": () =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            status: 1,
            product: {
              product_name: "Peanut Butter",
              serving_size: "32g",
              nutriments: {
                "energy-kcal_100g": 0, // stub
                "energy-kcal_serving": 0, // stub
                proteins_100g: 22,
                carbohydrates_100g: 22,
                fat_100g: 33,
              },
            },
          }),
        }),
      "food/?lang=en": () =>
        Promise.resolve({
          ok: true,
          json: async () => [
            { food_code: 4053, food_description: "Peanut butter, smooth" },
          ],
        }),
      "food/?lang=fr": emptyCNFFR,
      nutrientamount: () =>
        Promise.resolve({
          ok: true,
          json: async () => [
            {
              food_code: 4053,
              nutrient_value: 588,
              nutrient_name_id: 208,
              nutrient_web_name: "Energy (kcal)",
            },
          ],
        }),
    });

    const result = await lookupBarcode("999888777");
    expect(result).not.toBeNull();
    expect(result!.per100g.calories).toBe(588);
    expect(result!.source).toBe("cnf");
  });

  it("does NOT shield 0-and-0 kcal fields when the entry's own kJ fields are nonzero — kcal/kJ contradiction stays rescuable (PR #656 review)", async () => {
    // Explicit kcal 0s alongside real kJ values (energy_100g: 1700 kJ ≈ 406
    // kcal). The kcal 0 wins the ?? fallback (0 is not nullish), but the
    // entry's own kJ fields prove the zeros are transcription errors, not a
    // zero-calorie product — the secondary rescue must stay active.
    setupFetchMock({
      "openfoodfacts.org": () =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            status: 1,
            product: {
              product_name: "Granola Bar",
              serving_size: "40g",
              nutriments: {
                "energy-kcal_100g": 0, // bad transcription
                "energy-kcal_serving": 0, // bad transcription
                energy_100g: 1700,
                energy_serving: 680,
                proteins_100g: 0,
                carbohydrates_100g: 0,
                fat_100g: 0,
              },
            },
          }),
        }),
      "food/?lang=en": () =>
        Promise.resolve({
          ok: true,
          json: async () => [
            { food_code: 2588, food_description: "Granola bar, plain" },
          ],
        }),
      "food/?lang=fr": emptyCNFFR,
      nutrientamount: () =>
        Promise.resolve({
          ok: true,
          json: async () => [
            {
              food_code: 2588,
              nutrient_value: 471,
              nutrient_name_id: 208,
              nutrient_web_name: "Energy (kcal)",
            },
          ],
        }),
    });

    const result = await lookupBarcode("999888777");
    expect(result).not.toBeNull();
    expect(result!.per100g.calories).toBe(471);
    expect(result!.source).toBe("cnf");
  });

  it("keeps the zero shield when kJ fields hold only a sub-rounding trace (2 kJ < 0.5 kcal) — trace energy is not a contradiction (PR #656 review round 2)", async () => {
    // Some OFF water entries carry a trace kJ residual (energy_100g: 2 ≈ 0.48
    // kcal) beside explicit kcal zeros. The kcal derivation rounds that same
    // field to 0, so the contradiction check must apply the same rounding —
    // a raw `> 0` comparison would make the entry contradict itself and
    // reopen the phantom-calorie path for legitimate zero-cal products.
    setupFetchMock({
      "openfoodfacts.org": () =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            status: 1,
            product: {
              product_name: "Mineral Water",
              serving_size: "500g",
              nutriments: {
                "energy-kcal_100g": 0,
                "energy-kcal_serving": 0,
                energy_100g: 2, // trace kJ — rounds to 0 kcal
                proteins_100g: 0,
                carbohydrates_100g: 0,
                fat_100g: 0,
              },
            },
          }),
        }),
      "food/?lang=en": () =>
        Promise.resolve({
          ok: true,
          json: async () => [
            { food_code: 556, food_description: "Water, mineral, bottled" },
          ],
        }),
      "food/?lang=fr": emptyCNFFR,
      nutrientamount: () =>
        Promise.resolve({
          ok: true,
          json: async () => [
            {
              food_code: 556,
              nutrient_value: 48,
              nutrient_name_id: 208,
              nutrient_web_name: "Energy (kcal)",
            },
          ],
        }),
    });

    const result = await lookupBarcode("0060383653293");
    expect(result).not.toBeNull();
    expect(result!.per100g.calories).toBe(0);
    expect(result!.source).toBe("openfoodfacts");
  });

  it("derives the self-consistency signal from kJ-only energy_serving when energy-kcal_serving is absent", async () => {
    // Same McSweeney's data, but the per-serving energy arrives only as kJ
    // (energy_serving: 1297 kJ ≈ 310 kcal via /4.1868) — the conversion branch
    // must still corroborate per-100g × grams and block the secondary swap.
    setupFetchMock({
      "openfoodfacts.org": () =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            status: 1,
            product: {
              product_name: "Original Pep'n Ched",
              product_name_en: "Pepperoni & Cheddar Cheese Sticks",
              brands: "McSweeney's",
              serving_size: "90 g",
              categories_tags: ["en:cheese-snack"],
              nutriments: {
                "energy-kcal_100g": 344.444444444444,
                energy_serving: 1297, // kJ only — no energy-kcal_serving
                proteins_100g: 21.1111111111111,
                carbohydrates_100g: 1.11111111111111,
                fat_100g: 28.8888888888889,
              },
            },
          }),
        }),
      "food/?lang=en": () =>
        Promise.resolve({
          ok: true,
          json: async () => [
            {
              food_code: 130,
              food_description: "Cheese snack, processed cheese product",
            },
          ],
        }),
      "food/?lang=fr": emptyCNFFR,
      nutrientamount: () =>
        Promise.resolve({
          ok: true,
          json: async () => [
            {
              food_code: 130,
              nutrient_value: 109,
              nutrient_name_id: 208,
              nutrient_web_name: "Energy (kcal)",
            },
          ],
        }),
    });

    const result = await lookupBarcode("0778918011332");
    expect(result).not.toBeNull();
    expect(result!.per100g.calories).toBeCloseTo(344.4, 1);
    expect(result!.perServing.calories).toBe(310);
    expect(result!.source).toBe("openfoodfacts+self-consistent");
  });

  it("still swaps to the secondary on discrepancy when OFF has NO per-serving energy to corroborate its per-100g (Sugar case must keep working)", async () => {
    // Guard against over-correcting: the existing "OFF is wildly wrong" swap
    // (50 kcal/100g sugar vs CNF's 387) must survive. Here OFF has no
    // energy-kcal_serving, so there is no self-consistency signal and the
    // secondary replacement stays active.
    setupFetchMock({
      "openfoodfacts.org": () =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            status: 1,
            product: {
              product_name: "Sugar",
              serving_size: "40g",
              nutriments: {
                "energy-kcal_100g": 50,
                proteins_100g: 0,
                carbohydrates_100g: 12,
                fat_100g: 0,
              },
            },
          }),
        }),
      "food/?lang=en": () =>
        Promise.resolve({
          ok: true,
          json: async () => [
            { food_code: 4318, food_description: "Sweets, sugars, granulated" },
          ],
        }),
      "food/?lang=fr": emptyCNFFR,
      nutrientamount: () =>
        Promise.resolve({
          ok: true,
          json: async () => [
            {
              food_code: 4318,
              nutrient_value: 387,
              nutrient_name_id: 208,
              nutrient_web_name: "Energy (kcal)",
            },
          ],
        }),
    });

    const result = await lookupBarcode("999888777");
    expect(result).not.toBeNull();
    expect(result!.source).toBe("cnf");
    expect(result!.per100g.calories).toBe(387);
  });

  it("does not treat a label as self-consistent when per-serving disagrees with per-100g x grams (garbage OFF entry)", async () => {
    // OFF entry where someone entered per-serving calories that contradict
    // the product's own per-100g × serving-size math (say a copy-paste from a
    // different size variant). No self-consistency → the secondary still wins
    // on discrepancy.
    setupFetchMock({
      "openfoodfacts.org": () =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            status: 1,
            product: {
              product_name: "Sugar",
              serving_size: "40g",
              nutriments: {
                "energy-kcal_100g": 50, // wrong
                "energy-kcal_serving": 155, // implies 387/100g — contradicts the 50 above
                proteins_100g: 0,
                carbohydrates_100g: 12,
                fat_100g: 0,
              },
            },
          }),
        }),
      "food/?lang=en": () =>
        Promise.resolve({
          ok: true,
          json: async () => [
            { food_code: 4318, food_description: "Sweets, sugars, granulated" },
          ],
        }),
      "food/?lang=fr": emptyCNFFR,
      nutrientamount: () =>
        Promise.resolve({
          ok: true,
          json: async () => [
            {
              food_code: 4318,
              nutrient_value: 387,
              nutrient_name_id: 208,
              nutrient_web_name: "Energy (kcal)",
            },
          ],
        }),
    });

    const result = await lookupBarcode("999888777");
    expect(result).not.toBeNull();
    expect(result!.source).toBe("cnf");
    expect(result!.per100g.calories).toBe(387);
  });
});

describe("scaleNutrients — new nutrient fields (Universal Nutrition Flags v1)", () => {
  it("scales the new nutrients with the serving factor", () => {
    const scaled = scaleNutrients(
      {
        calories: 100,
        saturatedFat: 2,
        transFat: 0.5,
        cholesterol: 10,
        caffeine: 32,
      },
      2,
    );
    expect(scaled.saturatedFat).toBe(4);
    expect(scaled.transFat).toBe(1);
    expect(scaled.cholesterol).toBe(20);
    expect(scaled.caffeine).toBe(64);
  });
});

describe("lookupBarcode — OFF nutriment mapping (Universal Nutrition Flags v1, Task 3)", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    _resetCNFCacheForTesting();
  });

  it("maps OFF saturated-fat and caffeine (g→mg) into per100g", async () => {
    setupFetchMock({
      "openfoodfacts.org": () =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            status: 1,
            product: {
              product_name: "Energy Drink",
              nutriments: {
                "energy-kcal_100g": 45,
                "saturated-fat_100g": 0,
                caffeine_100g: 0.032,
              },
            },
          }),
        }),
      "food/?lang=en": emptyCNFEN,
      "food/?lang=fr": emptyCNFFR,
      "fdc/v1/foods/search": emptyUSDASearch,
    });

    const result = await lookupBarcode("5000000000000");
    expect(result).not.toBeNull();
    expect(result!.per100g.saturatedFat).toBe(0);
    expect(result!.per100g.caffeine).toBe(32); // 0.032 g → 32 mg
  });
});

describe("extractOffUniversalData", () => {
  it("pulls nova/nutriscore/additives/categories from an OFF product", () => {
    const out = extractOffUniversalData({
      nova_group: 4,
      nutriscore_grade: "e",
      additives_tags: ["en:e951", "en:e150d"],
      categories_tags: ["en:beverages", "en:energy-drinks"],
    });
    expect(out.novaGroup).toBe(4);
    expect(out.nutriScore).toBe("e");
    expect(out.additivesTags).toEqual(["en:e951", "en:e150d"]);
    expect(out.categoriesTags).toContain("en:beverages");
  });

  it("returns empty arrays and undefined grades for a null product", () => {
    const out = extractOffUniversalData(null);
    expect(out.additivesTags).toEqual([]);
    expect(out.novaGroup).toBeUndefined();
  });
});
