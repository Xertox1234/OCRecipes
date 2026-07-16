import { describe, it, expect, vi, beforeEach } from "vitest";

import { lookupBarcode } from "../barcode-lookup";
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
