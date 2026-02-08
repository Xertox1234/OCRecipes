import { describe, it, expect, vi, beforeEach } from "vitest";

import { lookupBarcode, _resetCNFCacheForTesting } from "../nutrition-lookup";

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
    () => Promise<{ ok: boolean; json: () => Promise<any> }>
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
});
