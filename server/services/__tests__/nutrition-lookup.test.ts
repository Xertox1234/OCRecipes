import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  lookupNutrition,
  batchNutritionLookup,
  _resetCNFCacheForTesting,
} from "../nutrition-lookup";
import { lookupBarcode } from "../barcode-lookup";

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

/** CNF with sugar data for cross-validation tests */
const cnfWithSugarEN = () =>
  Promise.resolve({
    ok: true,
    json: async () => [
      { food_code: 4318, food_description: "Sweets, sugars, granulated" },
      { food_code: 4317, food_description: "Sweets, sugar, brown" },
    ],
  });
const cnfWithSugarFR = () =>
  Promise.resolve({
    ok: true,
    json: async () => [
      { food_code: 4318, food_description: "Confiseries, sucre, granulé" },
      { food_code: 4317, food_description: "Confiseries, sucre, brun" },
    ],
  });
const cnfSugarNutrients = () =>
  Promise.resolve({
    ok: true,
    json: async () => [
      {
        food_code: 4318,
        nutrient_value: 387,
        nutrient_name_id: 208,
        nutrient_web_name: "Energy (kcal)",
      },
      {
        food_code: 4318,
        nutrient_value: 0,
        nutrient_name_id: 203,
        nutrient_web_name: "Protein",
      },
      {
        food_code: 4318,
        nutrient_value: 99.98,
        nutrient_name_id: 205,
        nutrient_web_name: "Carbohydrate",
      },
      {
        food_code: 4318,
        nutrient_value: 0,
        nutrient_name_id: 204,
        nutrient_web_name: "Total Fat",
      },
      {
        food_code: 4318,
        nutrient_value: 0,
        nutrient_name_id: 291,
        nutrient_web_name: "Fibre, total dietary",
      },
      {
        food_code: 4318,
        nutrient_value: 99.8,
        nutrient_name_id: 269,
        nutrient_web_name: "Sugars, total",
      },
      {
        food_code: 4318,
        nutrient_value: 1,
        nutrient_name_id: 307,
        nutrient_web_name: "Sodium, Na",
      },
    ],
  });

describe("lookupBarcode", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    _resetCNFCacheForTesting();
  });

  it("returns null when OFF has no product and no fallback", async () => {
    setupFetchMock({
      "openfoodfacts.org": () =>
        Promise.resolve({ ok: true, json: async () => ({ status: 0 }) }),
      "food/?lang=en": emptyCNFEN,
      "food/?lang=fr": emptyCNFFR,
    });

    const result = await lookupBarcode("0000000000000");
    expect(result).toBeNull();
  });

  it("returns OFF data when available and CNF confirms", async () => {
    setupFetchMock({
      "openfoodfacts.org": () =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            status: 1,
            product: {
              product_name: "Granulated Sugar",
              brands: "TestBrand",
              serving_size: "4g",
              nutriments: {
                "energy-kcal_100g": 400,
                proteins_100g: 0,
                carbohydrates_100g: 100,
                fat_100g: 0,
                fiber_100g: 0,
                sugars_100g: 100,
                sodium_100g: 0,
              },
            },
          }),
        }),
      // CNF food lists with sugar
      "food/?lang=en": cnfWithSugarEN,
      "food/?lang=fr": cnfWithSugarFR,
      // CNF nutrient amounts for sugar (code 4318)
      nutrientamount: cnfSugarNutrients,
    });

    const result = await lookupBarcode("1234567890");
    expect(result).not.toBeNull();
    expect(result!.productName).toBe("Granulated Sugar");
    // OFF has 400 kcal/100g, CNF has 387 kcal/100g — ratio ~1.03, within 2× threshold
    // so OFF values should be used (with verified flag)
    expect(result!.per100g.calories).toBe(400);
    expect(result!.source).toContain("verified");
    // Serving should be 4g as specified
    expect(result!.servingInfo.grams).toBe(4);
    // 4g of 400 kcal/100g = 16 kcal
    expect(result!.perServing.calories).toBe(16);
  });

  it("uses CNF when OFF per-100g is wildly wrong", async () => {
    setupFetchMock({
      "openfoodfacts.org": () =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            status: 1,
            product: {
              product_name: "Sugar",
              serving_size: "4g",
              nutriments: {
                "energy-kcal_100g": 50, // WRONG — should be ~400
                proteins_100g: 0,
                carbohydrates_100g: 12, // WRONG
                fat_100g: 0,
              },
            },
          }),
        }),
      // CNF will match "sugar" → "Sweets, sugars, granulated" → 387 kcal
      "food/?lang=en": cnfWithSugarEN,
      "food/?lang=fr": cnfWithSugarFR,
      nutrientamount: cnfSugarNutrients,
    });

    const result = await lookupBarcode("9999999999");
    expect(result).not.toBeNull();
    // OFF has 50, CNF has 387 — ratio 0.13 which is < 0.5, so CNF wins
    expect(result!.per100g.calories).toBe(387);
    expect(result!.source).toBe("cnf");
    // 4g serving: 387 * 0.04 ≈ 15 kcal
    expect(result!.perServing.calories).toBe(15);
    expect(result!.servingInfo.grams).toBe(4);
  });

  it("matches French product names via CNF", async () => {
    setupFetchMock({
      "openfoodfacts.org": () =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            status: 1,
            product: {
              product_name: "Sucre", // French name only!
              serving_size: "4g",
              nutriments: {
                "energy-kcal_100g": 50, // WRONG
                proteins_100g: 0,
                carbohydrates_100g: 12,
                fat_100g: 0,
              },
            },
          }),
        }),
      // CNF French list can match "Sucre" → "Confiseries, sucre, granulé"
      "food/?lang=en": cnfWithSugarEN,
      "food/?lang=fr": cnfWithSugarFR,
      nutrientamount: cnfSugarNutrients,
    });

    const result = await lookupBarcode("8888888888");
    expect(result).not.toBeNull();
    // CNF matched via French food list, returns correct calories
    expect(result!.per100g.calories).toBe(387);
    expect(result!.source).toBe("cnf");
  });

  it("corrects implausible serving sizes for multi-pack products", async () => {
    setupFetchMock({
      "openfoodfacts.org": () =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            status: 1,
            product: {
              product_name: "Hot Chocolate K-Cup Pods",
              serving_size: "236g", // whole box!
              nutriments: {
                "energy-kcal_100g": 400,
                proteins_100g: 5,
                carbohydrates_100g: 80,
                fat_100g: 5,
              },
            },
          }),
        }),
      // CNF food lists — hot chocolate should match
      "food/?lang=en": () =>
        Promise.resolve({
          ok: true,
          json: async () => [
            { food_code: 2869, food_description: "Hot chocolate, mix, powder" },
          ],
        }),
      "food/?lang=fr": () =>
        Promise.resolve({
          ok: true,
          json: async () => [
            {
              food_code: 2869,
              food_description: "Chocolat chaud, mélange sec",
            },
          ],
        }),
      nutrientamount: () =>
        Promise.resolve({
          ok: true,
          json: async () => [
            {
              food_code: 2869,
              nutrient_value: 398,
              nutrient_name_id: 208,
              nutrient_web_name: "Energy (kcal)",
            },
            {
              food_code: 2869,
              nutrient_value: 6.67,
              nutrient_name_id: 203,
              nutrient_web_name: "Protein",
            },
            {
              food_code: 2869,
              nutrient_value: 83.73,
              nutrient_name_id: 205,
              nutrient_web_name: "Carbohydrate",
            },
            {
              food_code: 2869,
              nutrient_value: 4,
              nutrient_name_id: 204,
              nutrient_web_name: "Total Fat",
            },
          ],
        }),
    });

    const result = await lookupBarcode("0663447217174");
    expect(result).not.toBeNull();
    // 236g serving at 400 kcal/100g = 944 kcal — exceeds 800 threshold
    expect(result!.servingInfo.wasCorrected).toBe(true);
    // For pod products, estimated serving is 15g
    expect(result!.servingInfo.grams).toBe(15);
    // 15g at 400 kcal/100g = 60 kcal
    expect(result!.perServing.calories).toBe(60);
  });

  it("falls back to USDA branded food by UPC when OFF has no product", async () => {
    setupFetchMock({
      // OFF doesn't have this barcode at all
      "openfoodfacts.org": () =>
        Promise.resolve({ ok: true, json: async () => ({ status: 0 }) }),
      // USDA branded food search finds it by UPC
      "fdc/v1/foods/search": () =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            foods: [
              {
                description: "COFFEE WHITENER",
                brandOwner: "Nestle",
                gtinUpc: "006073114236",
                foodNutrients: [
                  { nutrientName: "Energy", nutrientId: 1008, value: 500 },
                  { nutrientName: "Protein", nutrientId: 1003, value: 1 },
                  {
                    nutrientName: "Carbohydrate, by difference",
                    nutrientId: 1005,
                    value: 60,
                  },
                  {
                    nutrientName: "Total lipid (fat)",
                    nutrientId: 1004,
                    value: 30,
                  },
                  {
                    nutrientName: "Fiber, total dietary",
                    nutrientId: 1079,
                    value: 0,
                  },
                  {
                    nutrientName: "Sugars, total including NLEA",
                    nutrientId: 2000,
                    value: 40,
                  },
                  { nutrientName: "Sodium, Na", nutrientId: 1093, value: 50 },
                ],
              },
            ],
          }),
        }),
      // CNF food lists (will be searched with product name from USDA)
      "food/?lang=en": emptyCNFEN,
      "food/?lang=fr": emptyCNFFR,
    });

    const result = await lookupBarcode("6073114236");
    expect(result).not.toBeNull();
    expect(result!.productName).toBe("COFFEE WHITENER");
    expect(result!.brandName).toBe("Nestle");
    expect(result!.per100g.calories).toBe(500);
    expect(result!.source).toBe("usda");
  });

  it("USDA-UPC-only primary does not cross-validate against CNF (keeps usda source)", async () => {
    // OFF has no product → USDA-UPC supplies the primary, used directly as
    // authoritative (the call site bypasses `reconcilePer100g` entirely — there
    // is no second source to reconcile against, because the cross-validation
    // search terms are built solely from the absent OFF product). Even though
    // CNF *has* matching data here, it is deliberately ignored. This pins the
    // branch-1 behavior: USDA-UPC-only products are NOT cross-validated, and
    // missing nutrients default to 0 (from findNutrientValue), not gap-filled
    // from CNF. It is a regression guard: if a change ever cross-validates this
    // branch, fiber flips 0 → 3.
    setupFetchMock({
      "openfoodfacts.org": () =>
        Promise.resolve({ ok: true, json: async () => ({ status: 0 }) }),
      "fdc/v1/foods/search": () =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            foods: [
              {
                description: "Coffee Whitener",
                brandOwner: "Nestle",
                gtinUpc: "006073114236",
                foodNutrients: [
                  { nutrientName: "Energy", nutrientId: 1008, value: 500 },
                  { nutrientName: "Protein", nutrientId: 1003, value: 1 },
                  {
                    nutrientName: "Carbohydrate, by difference",
                    nutrientId: 1005,
                    value: 60,
                  },
                  {
                    nutrientName: "Total lipid (fat)",
                    nutrientId: 1004,
                    value: 30,
                  },
                  // No fiber/sugar/sodium → gaps to be filled from CNF.
                ],
              },
            ],
          }),
        }),
      // CNF food list matches the product name "Coffee Whitener".
      "food/?lang=en": () =>
        Promise.resolve({
          ok: true,
          json: async () => [
            { food_code: 5555, food_description: "Coffee Whitener" },
          ],
        }),
      "food/?lang=fr": () =>
        Promise.resolve({
          ok: true,
          json: async () => [
            { food_code: 5555, food_description: "Colorant à café" },
          ],
        }),
      // CNF nutrients: calories 480 (ratio 0.96 — close), plus the fields the
      // USDA-UPC primary lacks (fiber/sugar/sodium).
      nutrientamount: () =>
        Promise.resolve({
          ok: true,
          json: async () => [
            {
              food_code: 5555,
              nutrient_value: 480,
              nutrient_name_id: 208,
              nutrient_web_name: "Energy (kcal)",
            },
            {
              food_code: 5555,
              nutrient_value: 2,
              nutrient_name_id: 203,
              nutrient_web_name: "Protein",
            },
            {
              food_code: 5555,
              nutrient_value: 55,
              nutrient_name_id: 205,
              nutrient_web_name: "Carbohydrate",
            },
            {
              food_code: 5555,
              nutrient_value: 28,
              nutrient_name_id: 204,
              nutrient_web_name: "Total Fat",
            },
            {
              food_code: 5555,
              nutrient_value: 3,
              nutrient_name_id: 291,
              nutrient_web_name: "Fibre, total dietary",
            },
            {
              food_code: 5555,
              nutrient_value: 7,
              nutrient_name_id: 269,
              nutrient_web_name: "Sugars, total",
            },
            {
              food_code: 5555,
              nutrient_value: 90,
              nutrient_name_id: 307,
              nutrient_web_name: "Sodium, Na",
            },
          ],
        }),
    });

    const result = await lookupBarcode("6073114236");
    expect(result).not.toBeNull();
    // Primary kept verbatim — no cross-validation suffix.
    expect(result!.per100g.calories).toBe(500);
    expect(result!.source).toBe("usda");
    // Fields present on the primary are kept from the primary.
    expect(result!.per100g.protein).toBe(1);
    expect(result!.per100g.carbs).toBe(60);
    expect(result!.per100g.fat).toBe(30);
    // Fields absent from the USDA-UPC response default to 0 (findNutrientValue),
    // and are NOT gap-filled from CNF — proving branch 1 skips cross-validation.
    expect(result!.per100g.fiber).toBe(0);
    expect(result!.per100g.sugar).toBe(0);
    expect(result!.per100g.sodium).toBe(0);
    // The `secondaryPer100g === null` INVARIANT guard in the USDA-by-UPC branch
    // did not fire: even with CNF mocked to match, the secondary stays
    // structurally null here (search terms are built from the absent OFF
    // product). If a future refactor seeds a secondary into this path, the guard
    // throws in non-production and this test (which already drives the branch)
    // turns CI red — that is the self-enforcing regression tripwire.
  });

  it("keeps OFF data when the secondary source reports zero calories", async () => {
    // Case C: OFF has positive calories but the secondary (CNF) reports 0 kcal.
    // Current behavior keeps OFF (source "openfoodfacts") — the discrepancy
    // branches require BOTH sides positive, and OFF-positive skips the
    // "OFF-missing-calories → use secondary" arm. Pins the one branch-2 sub-case
    // with no coverage and guards the reconcile helper's disagreement condition.
    setupFetchMock({
      "openfoodfacts.org": () =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            status: 1,
            product: {
              product_name: "sugar",
              serving_size: "4g",
              nutriments: {
                "energy-kcal_100g": 400,
                proteins_100g: 0,
                carbohydrates_100g: 100,
                fat_100g: 0,
              },
            },
          }),
        }),
      "food/?lang=en": cnfWithSugarEN,
      "food/?lang=fr": cnfWithSugarFR,
      // CNF match for "sugar" but with 0 kcal — secondary calories === 0.
      nutrientamount: () =>
        Promise.resolve({
          ok: true,
          json: async () => [
            {
              food_code: 4318,
              nutrient_value: 0,
              nutrient_name_id: 208,
              nutrient_web_name: "Energy (kcal)",
            },
            {
              food_code: 4318,
              nutrient_value: 99.98,
              nutrient_name_id: 205,
              nutrient_web_name: "Carbohydrate",
            },
          ],
        }),
    });

    const result = await lookupBarcode("3333333333");
    expect(result).not.toBeNull();
    // CNF calories === 0 → lookupCNF returns null (0-calorie matches are
    // discarded), so no secondary at all. OFF data is kept verbatim.
    expect(result!.per100g.calories).toBe(400);
    expect(result!.source).toBe("openfoodfacts");
  });

  it("uses secondary data when OFF has no calorie data", async () => {
    // OFF product name "sugar" matches CNF "Sweets, sugars, granulated"
    setupFetchMock({
      "openfoodfacts.org": () =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            status: 1,
            product: {
              product_name: "sugar",
              nutriments: {
                // No energy-kcal_100g → calories = undefined
                proteins_100g: 0,
                carbohydrates_100g: 100,
                fat_100g: 0,
              },
            },
          }),
        }),
      "food/?lang=en": cnfWithSugarEN,
      "food/?lang=fr": cnfWithSugarFR,
      nutrientamount: cnfSugarNutrients,
    });

    const result = await lookupBarcode("5555555555");
    expect(result).not.toBeNull();
    // OFF has no calories (undefined), secondary (CNF) has 387
    expect(result!.per100g.calories).toBe(387);
    expect(result!.source).toBe("cnf");
  });

  it("uses secondary data when OFF calories are zero", async () => {
    // OFF product name "sugar" matches CNF for cross-validation
    setupFetchMock({
      "openfoodfacts.org": () =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            status: 1,
            product: {
              product_name: "sugar",
              nutriments: {
                "energy-kcal_100g": 0,
                proteins_100g: 0,
                carbohydrates_100g: 100,
                fat_100g: 0,
              },
            },
          }),
        }),
      "food/?lang=en": cnfWithSugarEN,
      "food/?lang=fr": cnfWithSugarFR,
      nutrientamount: cnfSugarNutrients,
    });

    const result = await lookupBarcode("6666666666");
    expect(result).not.toBeNull();
    // OFF has 0 calories, secondary (CNF) has 387
    expect(result!.per100g.calories).toBe(387);
    expect(result!.source).toBe("cnf");
  });

  it("returns product with no calorie data when no secondary source available", async () => {
    setupFetchMock({
      "openfoodfacts.org": () =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            status: 1,
            product: {
              product_name: "Known Product",
              nutriments: {
                proteins_100g: 5,
              },
            },
          }),
        }),
      "food/?lang=en": emptyCNFEN,
      "food/?lang=fr": emptyCNFFR,
    });

    const result = await lookupBarcode("7777777777");
    expect(result).not.toBeNull();
    expect(result!.productName).toBe("Known Product");
    // No calorie data, but product name exists, so result is returned
    expect(result!.per100g.calories).toBeUndefined();
  });

  it("handles fetch errors for OFF gracefully", async () => {
    setupFetchMock({
      "openfoodfacts.org": () => Promise.reject(new Error("network error")),
      "food/?lang=en": emptyCNFEN,
      "food/?lang=fr": emptyCNFFR,
    });

    const result = await lookupBarcode("0000000000001");
    // All OFF variants fail, no USDA data either → null
    expect(result).toBeNull();
  });

  it("parses a valid OFF product correctly (regression: schema must not drop real data)", async () => {
    // CNF/USDA are empty so OFF values flow through unmodified by cross-validation.
    setupFetchMock({
      "openfoodfacts.org": () =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            status: 1,
            product: {
              product_name: "Plain Oats",
              serving_size: "40g",
              nutriments: {
                "energy-kcal_100g": 370,
                proteins_100g: 13,
                carbohydrates_100g: 60,
                fat_100g: 7,
                fiber_100g: 10,
                sugars_100g: 1,
                sodium_100g: 0.002,
              },
            },
          }),
        }),
      "food/?lang=en": emptyCNFEN,
      "food/?lang=fr": emptyCNFFR,
    });

    const result = await lookupBarcode("1111111111111");
    expect(result).not.toBeNull();
    expect(result!.per100g.calories).toBe(370);
    expect(result!.per100g.protein).toBe(13);
    expect(result!.per100g.carbs).toBe(60);
    expect(result!.per100g.fat).toBe(7);
    expect(result!.per100g.fiber).toBe(10);
    expect(result!.per100g.sugar).toBe(1);
    // sodium_100g: 0.002 g/100g → 0.002 * 1000 = 2mg, rounded to 1 decimal
    expect(result!.per100g.sodium).toBe(2);
  });

  it("drops string/garbage OFF nutriments instead of poisoning the cache", async () => {
    // CNF/USDA are empty so OFF values flow through unmodified by cross-validation.
    // OFF returns "N/A" for sugars and a garbage string for fat — both must be dropped.
    setupFetchMock({
      "openfoodfacts.org": () =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            status: 1,
            product: {
              product_name: "Weird Product",
              serving_size: "30g",
              nutriments: {
                "energy-kcal_100g": 400,
                proteins_100g: 10,
                carbohydrates_100g: 50,
                fat_100g: "N/A",
                sugars_100g: "not reported",
                sodium_100g: null,
              },
            },
          }),
        }),
      "food/?lang=en": emptyCNFEN,
      "food/?lang=fr": emptyCNFFR,
    });

    const result = await lookupBarcode("2222222222222");
    expect(result).not.toBeNull();
    // Valid numeric fields must survive
    expect(result!.per100g.calories).toBe(400);
    expect(result!.per100g.protein).toBe(10);
    expect(result!.per100g.carbs).toBe(50);
    // Garbage string fields must be dropped (undefined), not written as NaN/string/0
    expect(result!.per100g.fat).toBeUndefined();
    expect(result!.per100g.sugar).toBeUndefined();
    expect(result!.per100g.sodium).toBeUndefined();
  });
});

describe("lookupNutrition", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    _resetCNFCacheForTesting();
  });

  it("returns CNF data when available", async () => {
    setupFetchMock({
      "food/?lang=en": cnfWithSugarEN,
      "food/?lang=fr": cnfWithSugarFR,
      nutrientamount: cnfSugarNutrients,
    });

    const result = await lookupNutrition("sugar");
    expect(result).not.toBeNull();
    expect(result!.source).toBe("cnf");
    expect(result!.calories).toBe(387);
    expect(result!.protein).toBe(0);
    expect(result!.carbs).toBe(99.98);
  });

  it("falls back to USDA when CNF has no match", async () => {
    setupFetchMock({
      "food/?lang=en": emptyCNFEN,
      "food/?lang=fr": emptyCNFFR,
      "fdc/v1/foods/search": () =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            foods: [
              {
                description: "Chicken Breast",
                foodNutrients: [
                  { nutrientName: "Energy", value: 165 },
                  { nutrientName: "Protein", value: 31 },
                  { nutrientName: "Carbohydrate, by difference", value: 0 },
                  { nutrientName: "Total lipid (fat)", value: 3.6 },
                  { nutrientName: "Fiber, total dietary", value: 0 },
                  { nutrientName: "Sugars, total", value: 0 },
                  { nutrientName: "Sodium, Na", value: 74 },
                ],
              },
            ],
          }),
        }),
    });

    const result = await lookupNutrition("chicken breast");
    expect(result).not.toBeNull();
    expect(result!.source).toBe("usda");
    expect(result!.calories).toBe(165);
    expect(result!.protein).toBe(31);
  });

  it("falls back to API Ninjas as last resort", async () => {
    const originalKey = process.env.API_NINJAS_KEY;
    process.env.API_NINJAS_KEY = "test-key";

    try {
      setupFetchMock({
        "food/?lang=en": emptyCNFEN,
        "food/?lang=fr": emptyCNFFR,
        "fdc/v1/foods/search": () =>
          Promise.resolve({
            ok: true,
            json: async () => ({ foods: [] }),
          }),
        "api-ninjas.com": () =>
          Promise.resolve({
            ok: true,
            json: async () => [
              {
                name: "banana",
                calories: 89,
                protein_g: 1.1,
                carbohydrates_total_g: 22.8,
                fat_total_g: 0.3,
                fiber_g: 2.6,
                sugar_g: 12.2,
                sodium_mg: 1,
                serving_size_g: 100,
              },
            ],
          }),
      });

      const result = await lookupNutrition("banana");
      expect(result).not.toBeNull();
      expect(result!.source).toBe("api-ninjas");
      expect(result!.calories).toBe(89);
    } finally {
      if (originalKey === undefined) delete process.env.API_NINJAS_KEY;
      else process.env.API_NINJAS_KEY = originalKey;
    }
  });

  it("returns null when no source has data", async () => {
    setupFetchMock({
      "food/?lang=en": emptyCNFEN,
      "food/?lang=fr": emptyCNFFR,
      "fdc/v1/foods/search": () =>
        Promise.resolve({
          ok: true,
          json: async () => ({ foods: [] }),
        }),
    });

    const result = await lookupNutrition("xyznonexistent");
    expect(result).toBeNull();
  });

  it("returns null when USDA returns non-ok response", async () => {
    setupFetchMock({
      "food/?lang=en": emptyCNFEN,
      "food/?lang=fr": emptyCNFFR,
      "fdc/v1/foods/search": () =>
        Promise.resolve({ ok: false, json: async () => ({}) }),
    });

    const result = await lookupNutrition("test food");
    expect(result).toBeNull();
  });
});

describe("batchNutritionLookup", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    _resetCNFCacheForTesting();
  });

  it("returns empty map for empty input", async () => {
    const result = await batchNutritionLookup([]);
    expect(result.size).toBe(0);
  });

  it("looks up multiple items in parallel", async () => {
    setupFetchMock({
      "food/?lang=en": cnfWithSugarEN,
      "food/?lang=fr": cnfWithSugarFR,
      nutrientamount: cnfSugarNutrients,
      "fdc/v1/foods/search": () =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            foods: [
              {
                description: "Chicken Breast",
                foodNutrients: [
                  { nutrientName: "Energy", value: 165 },
                  { nutrientName: "Protein", value: 31 },
                  { nutrientName: "Carbohydrate, by difference", value: 0 },
                  { nutrientName: "Total lipid (fat)", value: 3.6 },
                ],
              },
            ],
          }),
        }),
    });

    const result = await batchNutritionLookup(["sugar", "chicken breast"]);
    expect(result.size).toBe(2);

    const sugarData = result.get("sugar");
    expect(sugarData).not.toBeNull();
    expect(sugarData!.calories).toBe(387);
    expect(sugarData!.source).toBe("cnf");

    const chickenData = result.get("chicken breast");
    expect(chickenData).not.toBeNull();
    expect(chickenData!.calories).toBe(165);
    expect(chickenData!.source).toBe("usda");
  });

  it("returns null for items with no nutrition data", async () => {
    setupFetchMock({
      "food/?lang=en": emptyCNFEN,
      "food/?lang=fr": emptyCNFFR,
    });

    const result = await batchNutritionLookup(["nonexistentfood123"]);
    expect(result.size).toBe(1);
    expect(result.get("nonexistentfood123")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PR #269 reliability-audit: failure-mode branches
// ─────────────────────────────────────────────────────────────────────────────

describe("PR #269 — CNF safeParse failure branches", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    _resetCNFCacheForTesting();
  });

  it("falls through to USDA when the CNF food list response is not a valid array", async () => {
    // cnfFoodListSchema expects an array; returning an object fails safeParse →
    // cnfFoodsEN/FR remain null → lookupCNF returns null → USDA runs.
    setupFetchMock({
      "food/?lang=en": () =>
        Promise.resolve({ ok: true, json: async () => ({ error: "bad" }) }),
      "food/?lang=fr": () =>
        Promise.resolve({ ok: true, json: async () => ({ error: "bad" }) }),
      "fdc/v1/foods/search": () =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            foods: [
              {
                description: "Chicken Breast",
                foodNutrients: [
                  { nutrientName: "Energy", value: 165 },
                  { nutrientName: "Protein", value: 31 },
                  { nutrientName: "Carbohydrate, by difference", value: 0 },
                  { nutrientName: "Total lipid (fat)", value: 3.6 },
                  { nutrientName: "Fiber, total dietary", value: 0 },
                  { nutrientName: "Sugars, total", value: 0 },
                  { nutrientName: "Sodium, Na", value: 74 },
                ],
              },
            ],
          }),
        }),
    });

    const result = await lookupNutrition("chicken breast");
    expect(result).not.toBeNull();
    // CNF was unavailable (invalid response) — USDA took over
    expect(result!.source).toBe("usda");
    expect(result!.calories).toBe(165);
  });

  it("falls through to USDA when CNF nutrient amounts fail validation (strict field missing)", async () => {
    // CNF food list loads fine; the nutrient-amounts endpoint returns an object
    // missing `nutrient_web_name` (strict field) → safeParse fails → null from
    // lookupCNF → USDA fallback.
    setupFetchMock({
      "food/?lang=en": cnfWithSugarEN,
      "food/?lang=fr": cnfWithSugarFR,
      nutrientamount: () =>
        Promise.resolve({
          ok: true,
          json: async () => [
            // Missing required `nutrient_web_name`
            { food_code: 4318, nutrient_value: 387 },
          ],
        }),
      "fdc/v1/foods/search": () =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            foods: [
              {
                description: "Granulated Sugar",
                foodNutrients: [
                  { nutrientName: "Energy", value: 387 },
                  { nutrientName: "Protein", value: 0 },
                  { nutrientName: "Carbohydrate, by difference", value: 100 },
                  { nutrientName: "Total lipid (fat)", value: 0 },
                ],
              },
            ],
          }),
        }),
    });

    const result = await lookupNutrition("sugar");
    expect(result).not.toBeNull();
    // CNF nutrient parse failed → USDA took over
    expect(result!.source).toBe("usda");
    expect(result!.calories).toBe(387);
  });

  it("tolerates null values in the CNF nullish fields (food_code, nutrient_name_id)", async () => {
    // food_code and nutrient_name_id are `.nullish()` in cnfNutrientAmountListSchema.
    // A null in those fields must not invalidate the nutrient entry.
    setupFetchMock({
      "food/?lang=en": cnfWithSugarEN,
      "food/?lang=fr": cnfWithSugarFR,
      nutrientamount: () =>
        Promise.resolve({
          ok: true,
          json: async () => [
            {
              food_code: null,
              nutrient_value: 387,
              nutrient_name_id: null,
              nutrient_web_name: "Energy (kcal)",
            },
            {
              food_code: null,
              nutrient_value: 99.98,
              nutrient_name_id: null,
              nutrient_web_name: "Carbohydrate",
            },
            {
              food_code: null,
              nutrient_value: 0,
              nutrient_name_id: null,
              nutrient_web_name: "Protein",
            },
            {
              food_code: null,
              nutrient_value: 0,
              nutrient_name_id: null,
              nutrient_web_name: "Total Fat",
            },
          ],
        }),
    });

    const result = await lookupNutrition("sugar");
    expect(result).not.toBeNull();
    // Null nullish fields did not abort parse — CNF returned a valid result
    expect(result!.source).toBe("cnf");
    expect(result!.calories).toBe(387);
  });
});

describe("PR #269 — USDA-UPC safeParse failure branches", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    _resetCNFCacheForTesting();
  });

  it("tolerates a null `value` in USDA UPC food nutrients (coerces to 0, sibling food survives)", async () => {
    // USDA UPC response with a null nutrient value — usdaUpcFoodSchema coerces
    // null→0, so the food parses instead of failing the whole `foods` array.
    setupFetchMock({
      "openfoodfacts.org": () =>
        Promise.resolve({ ok: true, json: async () => ({ status: 0 }) }),
      "fdc/v1/foods/search": () =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            foods: [
              {
                description: "COFFEE WHITENER",
                brandOwner: "Nestle",
                gtinUpc: "006073114236",
                foodNutrients: [
                  { nutrientName: "Energy", nutrientId: 1008, value: 500 },
                  { nutrientName: "Protein", nutrientId: 1003, value: null }, // null value
                  {
                    nutrientName: "Carbohydrate, by difference",
                    nutrientId: 1005,
                    value: 60,
                  },
                  {
                    nutrientName: "Total lipid (fat)",
                    nutrientId: 1004,
                    value: 30,
                  },
                ],
              },
            ],
          }),
        }),
      "food/?lang=en": emptyCNFEN,
      "food/?lang=fr": emptyCNFFR,
    });

    const result = await lookupBarcode("6073114236");
    expect(result).not.toBeNull();
    // Food parsed despite null value — coerced to 0
    expect(result!.productName).toBe("COFFEE WHITENER");
    expect(result!.per100g.calories).toBe(500);
    // Protein coerced from null → 0
    expect(result!.per100g.protein).toBe(0);
  });

  it("tolerates a null `description` in a USDA UPC food, falls back to 'Unknown'", async () => {
    // usdaUpcFoodSchema allows description: null via `.nullish()`.
    // When description is null the code falls back to "Unknown".
    setupFetchMock({
      "openfoodfacts.org": () =>
        Promise.resolve({ ok: true, json: async () => ({ status: 0 }) }),
      "fdc/v1/foods/search": () =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            foods: [
              {
                description: null,
                brandOwner: "TestBrand",
                gtinUpc: "012345678901",
                foodNutrients: [
                  { nutrientName: "Energy", nutrientId: 1008, value: 200 },
                  { nutrientName: "Protein", nutrientId: 1003, value: 5 },
                  {
                    nutrientName: "Carbohydrate, by difference",
                    nutrientId: 1005,
                    value: 30,
                  },
                  {
                    nutrientName: "Total lipid (fat)",
                    nutrientId: 1004,
                    value: 5,
                  },
                ],
              },
            ],
          }),
        }),
      "food/?lang=en": emptyCNFEN,
      "food/?lang=fr": emptyCNFFR,
    });

    const result = await lookupBarcode("12345678901");
    expect(result).not.toBeNull();
    // null description tolerated; productName falls back to "Unknown"
    expect(result!.productName).toBe("Unknown");
    expect(result!.per100g.calories).toBe(200);
  });

  it("falls through when the entire USDA UPC response fails safeParse", async () => {
    // Returning a non-object (bare string) causes the whole safeParse to fail →
    // lookupUSDAByUPC returns null → no UPC fallback, no product found.
    setupFetchMock({
      "openfoodfacts.org": () =>
        Promise.resolve({ ok: true, json: async () => ({ status: 0 }) }),
      "fdc/v1/foods/search": () =>
        Promise.resolve({
          ok: true,
          json: async () => "not-an-object",
        }),
      "food/?lang=en": emptyCNFEN,
      "food/?lang=fr": emptyCNFFR,
    });

    const result = await lookupBarcode("0000000000000");
    // Invalid UPC response → no data at all → null
    expect(result).toBeNull();
  });
});
