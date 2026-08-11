import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { lookupBarcode, normalizeToPerHundredGrams } from "../barcode-lookup";
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
