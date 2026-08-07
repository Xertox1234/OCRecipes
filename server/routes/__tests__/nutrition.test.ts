import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { lookupNutrition } from "../../services/nutrition-lookup";
import { lookupBarcode } from "../../services/barcode-lookup";
import type { BarcodeLookupResult } from "../../services/barcode-lookup";
import { register } from "../nutrition";
import {
  createMockScannedItem,
  createMockNutritionData,
  createMockUserProfile,
} from "../../__tests__/factories";

vi.mock("../../storage", () => ({
  storage: {
    getScannedItems: vi.fn(),
    getScannedItemWithFavourite: vi.fn(),
    softDeleteScannedItem: vi.fn(),
    toggleFavouriteScannedItem: vi.fn(),
    getFrequentItems: vi.fn(),
    getDailySummary: vi.fn(),
    getConfirmedMealPlanItemIds: vi.fn(),
    getPlannedNutritionSummary: vi.fn(),
    getVerification: vi.fn().mockResolvedValue(null),
    getUserProfile: vi.fn().mockResolvedValue(null),
    createScannedItemWithLog: vi.fn(),
    getScannedItemByIdempotencyKey: vi.fn(),
  },
}));

vi.mock("../../middleware/auth");

vi.mock("express-rate-limit");

vi.mock("../../services/nutrition-lookup", () => ({
  lookupNutrition: vi.fn(),
}));

// Partial mock: `lookupBarcode` (I/O) is a test double, but `buildLabelConflict`
// (imported for real by the POST route) calls this module's own
// `parseServingGrams`/`scaleNutrients` pure helpers — those must stay real or
// the label-override math breaks with an "export not defined on mock" error.
vi.mock("../../services/barcode-lookup", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../services/barcode-lookup")>();
  return {
    ...actual,
    lookupBarcode: vi.fn(),
  };
});

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

const mockLookup = vi.mocked(lookupBarcode);

// DB result shaped like OFF's wrong Cherry Coke entry (per-100 ml) — mirrors
// Task 2's server/services/__tests__/label-override.test.ts cherryCokeDb()
// fixture so the conflict math (calories AND sugar) matches exactly.
function cherryCokeDbResult(): BarcodeLookupResult {
  return {
    productName: "Cherry Coke",
    barcode: "06772408",
    per100g: { calories: 11.11, sugar: 3.09, fat: 0 },
    perServing: { calories: 39, sugar: 11, fat: 0 },
    servingInfo: { displayLabel: "355 ml", grams: 355, wasCorrected: false },
    isServingDataTrusted: true,
    source: "openfoodfacts+self-consistent",
    allergenDataAvailable: true,
    novaGroup: 4,
    categoriesTags: ["en:colas", "en:beverages"],
  } satisfies BarcodeLookupResult;
}

// Same product, but the DB per-100 already agrees with the label (within the
// 25% valuesMatch threshold) — used for the no-conflict case.
function correctCokeDbResult(): BarcodeLookupResult {
  return {
    productName: "Cherry Coke",
    barcode: "06772408",
    per100g: { calories: 42, sugar: 11, fat: 0 },
    perServing: { calories: 149, sugar: 39, fat: 0 },
    servingInfo: { displayLabel: "355 ml", grams: 355, wasCorrected: false },
    isServingDataTrusted: true,
    source: "openfoodfacts+self-consistent",
    allergenDataAvailable: true,
    novaGroup: 4,
    categoriesTags: ["en:colas", "en:beverages"],
  } satisfies BarcodeLookupResult;
}

// ── Fixtures for the lost-flag notice (`nutrient-unavailable`) ──
//
// The notice has to name the CAUSE of a vanished nutrient warning, and the
// causes are behaviourally different enough that each needs its own record.
// All three are FOOD (no beverage category tag) so the FSA_FOOD lines apply:
// sugar > 22.5, saturatedFat > 5.0, sodium > 600 per 100 g. Every serving is
// under 100 g so the per-portion escalation branch stays inert.

// CONTAINMENT cause, exactly as reproduced in the PR #764 final review: the
// record's saturatedFat (8) is above the FSA high line, the label reads a
// corroborating totalFat that DISAGREES, and the label's own saturatedFat is a
// digit misread of its own panel ("2g 9%" -> 29). Provenance names only
// `totalFat`, so saturatedFat is never compared against the record — yet it is
// dropped, for exceeding the total fat it is part of. Carries no sodium/sugar
// so `nutrient:saturated_fat` is the record's ONLY nutrient flag.
function misreadSatFatDbResult(): BarcodeLookupResult {
  return {
    productName: "Aged Cheddar",
    barcode: "07100001",
    per100g: { calories: 500, fat: 5, saturatedFat: 8, protein: 20, carbs: 3 },
    perServing: {
      calories: 150,
      fat: 1.5,
      saturatedFat: 2.4,
      protein: 6,
      carbs: 0.9,
    },
    servingInfo: { displayLabel: "30 g", grams: 30, wasCorrected: false },
    isServingDataTrusted: true,
    source: "openfoodfacts+self-consistent",
    allergenDataAvailable: true,
    categoriesTags: ["en:cheeses"],
  } satisfies BarcodeLookupResult;
}

// Same record plus a high-sodium figure the label cannot read, so ONE response
// loses one flag to containment and another to blanking.
function misreadSatFatSaltyDbResult(): BarcodeLookupResult {
  const base = misreadSatFatDbResult();
  return {
    ...base,
    per100g: { ...base.per100g, sodium: 900 },
    perServing: { ...base.perServing, sodium: 270 },
  } satisfies BarcodeLookupResult;
}

// The label payload for both of the above. `directReads: ["totalFat"]` is
// load-bearing: it is what keeps saturatedFat OUT of the comparison, which is
// what makes "its values didn't match the label" a false statement about it.
const misreadSatFatLabel = {
  calories: 150, // ×(100/30) = 500 per-100 — AGREES with the record
  totalSugars: null,
  totalFat: 5, // ×(100/30) = 16.7 per-100 — disagrees with the record's 5
  saturatedFat: 29, // ×(100/30) = 96.7 per-100 — impossible against 16.7
  servingSize: "30 g",
  directReads: ["totalFat"],
};

// BLANKING cause: the label disagrees on CALORIES (a corroborating field), so
// the record's whole per-100 basis is judged wrong and its un-read macros —
// including the sodium behind the record's only nutrient flag — are dropped.
function highSodiumDbResult(): BarcodeLookupResult {
  return {
    productName: "Instant Noodles",
    barcode: "07100002",
    per100g: { calories: 450, sugar: 2, fat: 18, sodium: 900, carbs: 60 },
    perServing: {
      calories: 383,
      sugar: 1.7,
      fat: 15.3,
      sodium: 765,
      carbs: 51,
    },
    servingInfo: { displayLabel: "85 g", grams: 85, wasCorrected: false },
    isServingDataTrusted: true,
    source: "openfoodfacts+self-consistent",
    allergenDataAvailable: true,
    categoriesTags: ["en:meals"],
  } satisfies BarcodeLookupResult;
}

// NOT-A-LOSS case: a wrong-high OFF sugar figure (30 -> flagged) corrected by a
// label that READ sugar and read it low. The warning is correctly gone and the
// value is on screen, so there is nothing to apologise for.
function wrongHighSugarDbResult(): BarcodeLookupResult {
  return {
    productName: "Plain Yogurt",
    barcode: "07100003",
    per100g: { calories: 400, sugar: 30, protein: 5, carbs: 70, fat: 2 },
    perServing: { calories: 200, sugar: 15, protein: 2.5, carbs: 35, fat: 1 },
    servingInfo: { displayLabel: "50 g", grams: 50, wasCorrected: false },
    isServingDataTrusted: true,
    source: "openfoodfacts+self-consistent",
    allergenDataAvailable: true,
    categoriesTags: ["en:yogurts"],
  } satisfies BarcodeLookupResult;
}

const mockScannedItem = createMockScannedItem({
  id: 1,
  userId: "1",
  productName: "Greek Yogurt",
  brandName: "Fage",
  calories: "120",
  protein: "18",
  carbs: "6",
  fat: "2",
  barcode: "1234567890",
  servingSize: "170g",
  scannedAt: new Date("2024-01-15T12:00:00"),
});

describe("Nutrition Routes", () => {
  let app: express.Express;

  // Closes over the `app` reassigned in beforeEach below — declared here
  // (not module scope) so every nested it() sees the current test's app.
  function authedPost(path: string, body: object) {
    return request(app)
      .post(path)
      .set("Authorization", "Bearer token")
      .send(body);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  describe("GET /api/nutrition/lookup", () => {
    it("returns nutrition data for a valid name", async () => {
      vi.mocked(lookupNutrition).mockResolvedValue(
        createMockNutritionData({
          calories: 165,
          protein: 31,
          carbs: 0,
          fat: 3.6,
          source: "usda",
        }),
      );

      const res = await request(app)
        .get("/api/nutrition/lookup?name=chicken%20breast")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.calories).toBe(165);
    });

    it("returns 400 for missing name", async () => {
      const res = await request(app)
        .get("/api/nutrition/lookup")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
    });

    it("returns 400 for name exceeding 200 chars", async () => {
      const res = await request(app)
        .get(`/api/nutrition/lookup?name=${"x".repeat(201)}`)
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
    });

    it("returns 404 when nutrition data not found", async () => {
      vi.mocked(lookupNutrition).mockResolvedValue(null);

      const res = await request(app)
        .get("/api/nutrition/lookup?name=nonexistent%20food")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/nutrition/barcode/:code", () => {
    it("returns product data for valid barcode", async () => {
      vi.mocked(lookupBarcode).mockResolvedValue({
        productName: "Greek Yogurt",
        barcode: "1234567890",
        per100g: { calories: 120, protein: 18 },
        perServing: { calories: 120, protein: 18 },
        servingInfo: {
          displayLabel: "1 serving",
          grams: 170,
          wasCorrected: false,
        },
        isServingDataTrusted: true,
        source: "openfoodfacts",
        allergenDataAvailable: false,
      } satisfies BarcodeLookupResult);

      const res = await request(app)
        .get("/api/nutrition/barcode/1234567890")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.productName).toBe("Greek Yogurt");
    });

    it("returns 400 for non-numeric barcode", async () => {
      const res = await request(app)
        .get("/api/nutrition/barcode/abc123")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid barcode");
    });

    it("returns 404 when product not found", async () => {
      vi.mocked(lookupBarcode).mockResolvedValue(null);

      const res = await request(app)
        .get("/api/nutrition/barcode/9999999999")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
    });
  });

  describe("GET /api/nutrition/barcode/:code — allergen safety flags", () => {
    it("flags a danger allergen match when the profile has a declared severe allergy", async () => {
      vi.mocked(storage.getUserProfile).mockResolvedValue(
        createMockUserProfile({
          allergies: [{ name: "peanuts", severity: "severe" }],
        }),
      );
      vi.mocked(lookupBarcode).mockResolvedValue({
        productName: "Peanut Butter Cups",
        barcode: "1234567890",
        per100g: { calories: 120, protein: 18 },
        perServing: { calories: 120, protein: 18 },
        servingInfo: {
          displayLabel: "1 serving",
          grams: 170,
          wasCorrected: false,
        },
        isServingDataTrusted: true,
        source: "openfoodfacts",
        allergenTags: ["en:peanuts"],
        allergenDataAvailable: true,
      } satisfies BarcodeLookupResult);

      const res = await request(app)
        .get("/api/nutrition/barcode/1234567890")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.flags).toContainEqual(
        expect.objectContaining({
          allergenId: "peanuts",
          kind: "allergen",
          severity: "danger",
        }),
      );
    });

    it("fails dangerous (200, not 500) with a profile-unavailable flag when the profile read rejects", async () => {
      vi.mocked(storage.getUserProfile).mockRejectedValueOnce(
        new Error("db down"),
      );
      vi.mocked(lookupBarcode).mockResolvedValue({
        productName: "Greek Yogurt",
        barcode: "1234567890",
        per100g: { calories: 120, protein: 18 },
        perServing: { calories: 120, protein: 18 },
        servingInfo: {
          displayLabel: "1 serving",
          grams: 170,
          wasCorrected: false,
        },
        isServingDataTrusted: true,
        source: "openfoodfacts",
        allergenDataAvailable: false,
      } satisfies BarcodeLookupResult);

      const res = await request(app)
        .get("/api/nutrition/barcode/1234567890")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.flags).toContainEqual(
        expect.objectContaining({
          id: "profile-unavailable",
          kind: "allergen-unavailable",
        }),
      );
    });
  });

  describe("GET /api/nutrition/barcode/:code — universal nutrition flags", () => {
    it("attaches universal flags and strips raw OFF content", async () => {
      vi.mocked(lookupBarcode).mockResolvedValue({
        productName: "Monster",
        barcode: "070847811169",
        source: "off",
        per100g: { sugar: 11.4, caffeine: 34 },
        perServing: { sugar: 13, caffeine: 160 },
        servingInfo: {
          displayLabel: "1 can",
          grams: 473,
          wasCorrected: false,
        },
        isServingDataTrusted: true,
        allergenDataAvailable: false,
        novaGroup: 4,
        nutriScore: "e",
        additivesTags: ["en:e951"],
        categoriesTags: ["en:beverages"],
      } satisfies BarcodeLookupResult);

      const res = await request(app)
        .get("/api/nutrition/barcode/070847811169")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      const ids = res.body.flags.map((f: { id: string }) => f.id);
      expect(ids).toEqual(
        expect.arrayContaining([
          "processing:ultra",
          "nutrient:caffeine",
          "sweetener:artificial",
          "nutriscore:e",
        ]),
      );
      expect(res.body.novaGroup).toBe(4);
      expect(res.body.nutriScore).toBe("e");
      expect(res.body.additivesTags).toBeUndefined();
      expect(res.body.categoriesTags).toBeUndefined();
    });

    it("orders allergen (Phase 1) flags before universal flags", async () => {
      vi.mocked(storage.getUserProfile).mockResolvedValue(
        createMockUserProfile({
          allergies: [{ name: "peanuts", severity: "severe" }],
        }),
      );
      vi.mocked(lookupBarcode).mockResolvedValue({
        productName: "Peanut Energy Bar",
        barcode: "070847811169",
        source: "off",
        per100g: { sugar: 11.4, caffeine: 34 },
        perServing: { sugar: 13, caffeine: 160 },
        servingInfo: {
          displayLabel: "1 bar",
          grams: 473,
          wasCorrected: false,
        },
        isServingDataTrusted: true,
        allergenTags: ["en:peanuts"],
        allergenDataAvailable: true,
        novaGroup: 4,
        nutriScore: "e",
        additivesTags: ["en:e951"],
        categoriesTags: ["en:beverages"],
      } satisfies BarcodeLookupResult);

      const res = await request(app)
        .get("/api/nutrition/barcode/070847811169")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      const ids: string[] = res.body.flags.map((f: { id: string }) => f.id);
      const allergenIndex = ids.indexOf("allergen:peanuts");
      const universalIndex = ids.indexOf("processing:ultra");
      expect(allergenIndex).toBeGreaterThanOrEqual(0);
      expect(universalIndex).toBeGreaterThan(allergenIndex);
    });
  });

  describe("GET /api/nutrition/barcode/:code — isBeverage", () => {
    it("returns isBeverage true for a product tagged en:beverages", async () => {
      vi.mocked(lookupBarcode).mockResolvedValue({
        productName: "Cherry Coke",
        barcode: "06772408",
        per100g: { calories: 42, sugar: 11, fat: 0 },
        perServing: { calories: 149, sugar: 39, fat: 0 },
        servingInfo: {
          displayLabel: "355 ml",
          grams: 355,
          wasCorrected: false,
        },
        isServingDataTrusted: true,
        source: "openfoodfacts+self-consistent",
        allergenDataAvailable: true,
        novaGroup: 4,
        categoriesTags: ["en:colas", "en:beverages"],
      } satisfies BarcodeLookupResult);

      const res = await request(app)
        .get("/api/nutrition/barcode/06772408")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.isBeverage).toBe(true);
    });

    it("returns isBeverage false for a food", async () => {
      vi.mocked(lookupBarcode).mockResolvedValue({
        productName: "Greek Yogurt",
        barcode: "1234567890",
        per100g: { calories: 120, protein: 18 },
        perServing: { calories: 120, protein: 18 },
        servingInfo: {
          displayLabel: "1 serving",
          grams: 170,
          wasCorrected: false,
        },
        isServingDataTrusted: true,
        source: "openfoodfacts",
        allergenDataAvailable: false,
        categoriesTags: ["en:snacks"],
      } satisfies BarcodeLookupResult);

      const res = await request(app)
        .get("/api/nutrition/barcode/1234567890")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.isBeverage).toBe(false);
    });

    // The realistic "no category signal" shape: extractOffUniversalData
    // (barcode-lookup.ts) always defaults categoriesTags to `[]`, never
    // `undefined` — a USDA-only match or an OFF product missing
    // categories_tags both land here. An empty array must NOT be read as
    // "confirmed not a beverage": isBeverage must be OMITTED, not `false`,
    // or Task 6's resolveBasis short-circuits to the food scale before its
    // serving-unit fallback ever runs, silently halving FSA thresholds for
    // a real drink that just lacks OFF category data.
    it("omits isBeverage entirely when categoriesTags is empty (no category signal)", async () => {
      vi.mocked(lookupBarcode).mockResolvedValue({
        productName: "Mystery Item",
        barcode: "1234567890",
        per100g: { calories: 120 },
        perServing: { calories: 120 },
        servingInfo: {
          displayLabel: "1 serving",
          grams: 100,
          wasCorrected: false,
        },
        isServingDataTrusted: true,
        source: "openfoodfacts",
        allergenDataAvailable: false,
        categoriesTags: [],
      } satisfies BarcodeLookupResult);

      const res = await request(app)
        .get("/api/nutrition/barcode/1234567890")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      // Not `toBeUndefined()`: that assertion also passes for a present
      // key whose value happens to be undefined/null after serialization
      // and would not catch a regression that emits `isBeverage: null`.
      expect(res.body).not.toHaveProperty("isBeverage");
    });

    it("still strips the raw ODbL tag fields", async () => {
      // The whole point of deriving a scalar is that the tags do NOT ship.
      // If this ever passes with categoriesTags present, the licence
      // boundary has been broken, not merely the test.
      vi.mocked(lookupBarcode).mockResolvedValue({
        productName: "Cherry Coke",
        barcode: "06772408",
        per100g: { calories: 42, sugar: 11, fat: 0 },
        perServing: { calories: 149, sugar: 39, fat: 0 },
        servingInfo: {
          displayLabel: "355 ml",
          grams: 355,
          wasCorrected: false,
        },
        isServingDataTrusted: true,
        source: "openfoodfacts+self-consistent",
        allergenDataAvailable: true,
        novaGroup: 4,
        categoriesTags: ["en:colas", "en:beverages"],
      } satisfies BarcodeLookupResult);

      const res = await request(app)
        .get("/api/nutrition/barcode/06772408")
        .set("Authorization", "Bearer token");

      expect(res.body).not.toHaveProperty("categoriesTags");
      expect(res.body).not.toHaveProperty("additivesTags");
      expect(res.body).not.toHaveProperty("ingredientsText");
      expect(res.body).not.toHaveProperty("allergenTags");
    });

    it("appears on the nested conflict.label body too, not only at the top level", async () => {
      mockLookup.mockResolvedValue(cherryCokeDbResult()); // categoriesTags: en:colas, en:beverages
      const res = await authedPost("/api/nutrition/barcode/06772408", {
        labelNutrition: {
          calories: 150,
          totalSugars: 39,
          totalFat: 0,
          saturatedFat: null,
          servingSize: "355 mL",
        },
      });

      expect(res.status).toBe(200);
      expect(res.body.isBeverage).toBe(true);
      expect(res.body.conflict.label.isBeverage).toBe(true);
    });

    it("omits isBeverage on BOTH the top level and conflict.label when categoriesTags is empty", async () => {
      // A field that silently differs between branches is exactly what
      // buildBarcodeResponseBody exists to prevent — check the "no signal"
      // case is also consistent across both surfaces, not just the
      // confirmed-beverage case above.
      mockLookup.mockResolvedValue({
        ...cherryCokeDbResult(),
        categoriesTags: [],
      });
      const res = await authedPost("/api/nutrition/barcode/06772408", {
        labelNutrition: {
          calories: 150,
          totalSugars: 39,
          totalFat: 0,
          saturatedFat: null,
          servingSize: "355 mL",
        },
      });

      expect(res.status).toBe(200);
      expect(res.body.conflict).toBeDefined();
      expect(res.body).not.toHaveProperty("isBeverage");
      expect(res.body.conflict.label).not.toHaveProperty("isBeverage");
    });
  });

  describe("GET /api/scanned-items", () => {
    it("returns scanned items list", async () => {
      (storage.getScannedItems as Mock).mockResolvedValue([mockScannedItem]);

      const res = await request(app)
        .get("/api/scanned-items")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].productName).toBe("Greek Yogurt");
    });

    it("respects limit and offset parameters", async () => {
      (storage.getScannedItems as Mock).mockResolvedValue([]);

      await request(app)
        .get("/api/scanned-items?limit=10&offset=5")
        .set("Authorization", "Bearer token");

      expect(storage.getScannedItems).toHaveBeenCalledWith("1", 10, 5);
    });
  });

  describe("GET /api/scanned-items/:id", () => {
    it("returns a scanned item by ID", async () => {
      vi.mocked(storage.getScannedItemWithFavourite).mockResolvedValue({
        ...mockScannedItem,
        isFavourited: false,
      });

      const res = await request(app)
        .get("/api/scanned-items/1")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.productName).toBe("Greek Yogurt");
    });

    it("returns 404 for item owned by another user", async () => {
      vi.mocked(storage.getScannedItemWithFavourite).mockResolvedValue({
        ...mockScannedItem,
        userId: "2",
        isFavourited: false,
      });

      const res = await request(app)
        .get("/api/scanned-items/1")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(404);
    });

    it("returns 404 when item is null", async () => {
      vi.mocked(storage.getScannedItemWithFavourite).mockResolvedValue(
        undefined,
      );

      const res = await request(app)
        .get("/api/scanned-items/999")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(404);
    });

    it("returns 400 for invalid ID", async () => {
      const res = await request(app)
        .get("/api/scanned-items/abc")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
    });

    it("returns 500 on storage error", async () => {
      vi.mocked(storage.getScannedItemWithFavourite).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .get("/api/scanned-items/1")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
      expect(res.body.error).toBeDefined();
    });
  });

  describe("POST /api/scanned-items/:id/favourite", () => {
    it("toggles favourite status", async () => {
      vi.mocked(storage.toggleFavouriteScannedItem).mockResolvedValue(true);

      const res = await request(app)
        .post("/api/scanned-items/1/favourite")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.isFavourited).toBe(true);
    });

    it("returns 404 when toggle returns null (item not found or not owned)", async () => {
      vi.mocked(storage.toggleFavouriteScannedItem).mockResolvedValue(null);

      const res = await request(app)
        .post("/api/scanned-items/999/favourite")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
    });

    it("returns 400 for invalid ID", async () => {
      const res = await request(app)
        .post("/api/scanned-items/abc/favourite")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
    });

    it("returns 500 when storage throws", async () => {
      vi.mocked(storage.toggleFavouriteScannedItem).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .post("/api/scanned-items/1/favourite")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
      expect(res.body.error).toBeDefined();
    });
  });

  describe("POST /api/scanned-items", () => {
    it("creates a scanned item with daily log via storage", async () => {
      vi.mocked(storage.createScannedItemWithLog).mockResolvedValue(
        mockScannedItem,
      );

      const res = await request(app)
        .post("/api/scanned-items")
        .set("Authorization", "Bearer token")
        .send({
          productName: "Greek Yogurt",
          brandName: "Fage",
          calories: 120,
          protein: 18,
          carbs: 6,
          fat: 2,
        });

      expect(res.status).toBe(201);
      expect(res.body.productName).toBe("Greek Yogurt");
      expect(storage.createScannedItemWithLog).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "1",
          productName: "Greek Yogurt",
          brandName: "Fage",
        }),
      );
    });

    it("returns 400 when Zod validation fails", async () => {
      const res = await request(app)
        .post("/api/scanned-items")
        .set("Authorization", "Bearer token")
        .send({ productName: "" }); // min(1) requires non-empty

      expect(res.status).toBe(400);
    });

    it("returns 400 for non-numeric barcode", async () => {
      const res = await request(app)
        .post("/api/scanned-items")
        .set("Authorization", "Bearer token")
        .send({ productName: "Test Item", barcode: "abc123", calories: 100 });

      expect(res.status).toBe(400);
    });

    it("returns 400 for barcode exceeding 50 chars", async () => {
      const res = await request(app)
        .post("/api/scanned-items")
        .set("Authorization", "Bearer token")
        .send({
          productName: "Test Item",
          barcode: "1".repeat(51),
          calories: 100,
        });

      expect(res.status).toBe(400);
    });

    it("returns 400 for productName exceeding 200 chars", async () => {
      const res = await request(app)
        .post("/api/scanned-items")
        .set("Authorization", "Bearer token")
        .send({ productName: "x".repeat(201), calories: 100 });

      expect(res.status).toBe(400);
    });

    it("returns 500 when storage throws", async () => {
      vi.mocked(storage.createScannedItemWithLog).mockRejectedValue(
        new Error("Storage error"),
      );

      const res = await request(app)
        .post("/api/scanned-items")
        .set("Authorization", "Bearer token")
        .send({
          productName: "Test Item",
          calories: 100,
        });

      expect(res.status).toBe(500);
    });
  });

  describe("POST /api/scanned-items — idempotency", () => {
    it("returns existing item when X-Idempotency-Key matches a prior request", async () => {
      const existingItem = createMockScannedItem({
        id: 99,
        idempotencyKey: "test-uuid-1",
      });
      vi.mocked(storage.getScannedItemByIdempotencyKey).mockResolvedValue(
        existingItem,
      );

      const res = await request(app)
        .post("/api/scanned-items")
        .set("Authorization", "Bearer token")
        .set("X-Idempotency-Key", "test-uuid-1")
        .send({ productName: "Apple", calories: 52 });

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(99);
      expect(storage.createScannedItemWithLog).not.toHaveBeenCalled();
    });

    it("creates a new item and stores the key when no prior match exists", async () => {
      vi.mocked(storage.getScannedItemByIdempotencyKey).mockResolvedValue(null);
      const newItem = createMockScannedItem({
        id: 100,
        idempotencyKey: "test-uuid-2",
      });
      vi.mocked(storage.createScannedItemWithLog).mockResolvedValue(newItem);

      const res = await request(app)
        .post("/api/scanned-items")
        .set("Authorization", "Bearer token")
        .set("X-Idempotency-Key", "test-uuid-2")
        .send({ productName: "Banana", calories: 89 });

      expect(res.status).toBe(201);
      expect(storage.createScannedItemWithLog).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: "test-uuid-2" }),
      );
    });

    it("creates normally when no X-Idempotency-Key header is present", async () => {
      const newItem = createMockScannedItem({ id: 101 });
      vi.mocked(storage.createScannedItemWithLog).mockResolvedValue(newItem);

      const res = await request(app)
        .post("/api/scanned-items")
        .set("Authorization", "Bearer token")
        .send({ productName: "Cherry", calories: 63 });

      expect(res.status).toBe(201);
      expect(storage.getScannedItemByIdempotencyKey).not.toHaveBeenCalled();
    });

    it("returns the existing item (200) when a concurrent insert loses the unique race (M3)", async () => {
      // Existence check passes (no row yet), then the insert loses the race and
      // hits the (userId, idempotencyKey) unique index → 23505. The handler must
      // re-fetch and return the winning row (200), not surface a 500.
      vi.mocked(storage.getScannedItemByIdempotencyKey)
        .mockResolvedValueOnce(null) // initial existence check
        .mockResolvedValueOnce(
          createMockScannedItem({ id: 200, idempotencyKey: "race-uuid" }),
        ); // re-fetch in the catch
      const dupError = Object.assign(new Error("duplicate key value"), {
        code: "23505",
      });
      vi.mocked(storage.createScannedItemWithLog).mockRejectedValue(dupError);

      const res = await request(app)
        .post("/api/scanned-items")
        .set("Authorization", "Bearer token")
        .set("X-Idempotency-Key", "race-uuid")
        .send({ productName: "Date", calories: 20 });

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(200);
      expect(storage.getScannedItemByIdempotencyKey).toHaveBeenCalledTimes(2);
    });

    it("ignores an over-long X-Idempotency-Key rather than persisting it (L1)", async () => {
      const newItem = createMockScannedItem({ id: 201 });
      vi.mocked(storage.createScannedItemWithLog).mockResolvedValue(newItem);

      const res = await request(app)
        .post("/api/scanned-items")
        .set("Authorization", "Bearer token")
        .set("X-Idempotency-Key", "x".repeat(201))
        .send({ productName: "Fig", calories: 30 });

      expect(res.status).toBe(201);
      // Over-long key ignored: no dedup lookup, and null stored (not the giant value).
      expect(storage.getScannedItemByIdempotencyKey).not.toHaveBeenCalled();
      expect(storage.createScannedItemWithLog).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: null }),
      );
    });
  });

  describe("DELETE /api/scanned-items/:id", () => {
    it("soft deletes a scanned item", async () => {
      vi.mocked(storage.softDeleteScannedItem).mockResolvedValue(true);

      const res = await request(app)
        .delete("/api/scanned-items/1")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(204);
    });

    it("returns 404 for non-existent item", async () => {
      vi.mocked(storage.softDeleteScannedItem).mockResolvedValue(false);

      const res = await request(app)
        .delete("/api/scanned-items/999")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(404);
    });

    it("returns 400 for invalid ID", async () => {
      const res = await request(app)
        .delete("/api/scanned-items/abc")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
    });

    it("returns 500 when storage throws", async () => {
      vi.mocked(storage.softDeleteScannedItem).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .delete("/api/scanned-items/1")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
    });
  });

  describe("GET /api/daily-summary", () => {
    it("returns daily summary for today", async () => {
      const mockSummary = {
        totalCalories: 1500,
        totalProtein: 100,
        totalCarbs: 200,
        totalFat: 50,
        itemCount: 0,
      };
      vi.mocked(storage.getDailySummary).mockResolvedValue(mockSummary);
      vi.mocked(storage.getConfirmedMealPlanItemIds).mockResolvedValue([]);
      vi.mocked(storage.getPlannedNutritionSummary).mockResolvedValue({
        plannedCalories: 0,
        plannedProtein: 0,
        plannedCarbs: 0,
        plannedFat: 0,
        plannedItemCount: 0,
      });

      const res = await request(app)
        .get("/api/daily-summary")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.totalCalories).toBe(1500);
      expect(res.body).toHaveProperty("confirmedMealPlanItemIds");
    });

    it("accepts date parameter and passes parsed date to storage", async () => {
      vi.mocked(storage.getDailySummary).mockResolvedValue({
        totalCalories: 0,
        totalProtein: 0,
        totalCarbs: 0,
        totalFat: 0,
        itemCount: 0,
      });
      vi.mocked(storage.getConfirmedMealPlanItemIds).mockResolvedValue([]);
      vi.mocked(storage.getPlannedNutritionSummary).mockResolvedValue({
        plannedCalories: 0,
        plannedProtein: 0,
        plannedCarbs: 0,
        plannedFat: 0,
        plannedItemCount: 0,
      });

      const res = await request(app)
        .get("/api/daily-summary?date=2024-01-15")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      const passedDate = vi.mocked(storage.getDailySummary).mock
        .calls[0][1] as Date;
      expect(passedDate.toISOString()).toContain("2024-01-15");
    });

    it("returns 500 when storage throws", async () => {
      vi.mocked(storage.getDailySummary).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .get("/api/daily-summary")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
    });
  });

  describe("Error catch blocks", () => {
    it("GET /api/nutrition/lookup returns 500 on service error", async () => {
      vi.mocked(lookupNutrition).mockRejectedValue(new Error("API down"));

      const res = await request(app)
        .get("/api/nutrition/lookup?name=chicken")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
      expect(res.body.error).toBeDefined();
    });

    it("GET /api/nutrition/barcode/:code returns 500 on service error", async () => {
      vi.mocked(lookupBarcode).mockRejectedValue(new Error("API down"));

      const res = await request(app)
        .get("/api/nutrition/barcode/1234567890")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
      expect(res.body.error).toBeDefined();
    });

    it("GET /api/scanned-items returns 500 on storage error", async () => {
      vi.mocked(storage.getScannedItems).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .get("/api/scanned-items")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
      expect(res.body.error).toBeDefined();
    });
  });

  describe("GET /api/nutrition/barcode — edge cases", () => {
    it("returns 400 for barcode exceeding 50 chars", async () => {
      const longBarcode = "1".repeat(51);
      const res = await request(app)
        .get(`/api/nutrition/barcode/${longBarcode}`)
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid barcode");
    });
  });

  describe("POST /api/nutrition/barcode/:code (label override)", () => {
    it("returns a conflict with a label result whose flags include High-in-Sugar", async () => {
      mockLookup.mockResolvedValue(cherryCokeDbResult()); // per-100 11.11 kcal / 3.09 sugar, nova 4, en:colas
      const res = await authedPost("/api/nutrition/barcode/06772408", {
        labelNutrition: {
          calories: 150,
          totalSugars: 39,
          totalFat: 0,
          saturatedFat: null,
          servingSize: "355 mL",
        },
      });
      expect(res.status).toBe(200);
      expect(res.body.conflict.fields).toEqual(
        expect.arrayContaining(["calories", "sugar"]),
      );
      const labelFlagIds = res.body.conflict.label.flags.map(
        (f: { id: string }) => f.id,
      );
      expect(labelFlagIds).toContain("nutrient:sugar"); // High in Sugar now fires
      expect(labelFlagIds).toContain("processing:ultra"); // NOVA-4 retained from DB
      // Category-derived (en:colas, from the DB's categoriesTags, retained
      // on the label result) — fires even though the label never read a
      // caffeine value and the blanked label per100g has no numeric caffeine.
      expect(labelFlagIds).toContain("nutrient:caffeine");
      expect(res.body.conflict.label.servingInfo.grams).toBe(355);
    });

    it("strips ODbL fields (categoriesTags/additivesTags) on BOTH branches", async () => {
      mockLookup.mockResolvedValue(cherryCokeDbResult());
      const res = await authedPost("/api/nutrition/barcode/06772408", {
        labelNutrition: {
          calories: 150,
          totalSugars: 39,
          totalFat: 0,
          saturatedFat: null,
          servingSize: "355 mL",
        },
      });
      expect(res.body.categoriesTags).toBeUndefined();
      expect(res.body.conflict.label.categoriesTags).toBeUndefined();
      expect(res.body.conflict.label.additivesTags).toBeUndefined();
    });

    it("no conflict key when the label agrees (today's shape)", async () => {
      mockLookup.mockResolvedValue(correctCokeDbResult()); // per-100 ~42 kcal / ~11 sugar
      const res = await authedPost("/api/nutrition/barcode/06772408", {
        labelNutrition: {
          calories: 150,
          totalSugars: 39,
          totalFat: 0,
          saturatedFat: null,
          servingSize: "355 mL",
        },
      });
      expect(res.body.conflict).toBeUndefined();
    });

    it("rejects a malformed labelNutrition body (zod 400)", async () => {
      const res = await authedPost("/api/nutrition/barcode/06772408", {
        labelNutrition: { calories: "lots" },
      });
      expect(res.status).toBe(400);
    });

    // ── labelCompared on the wire ──
    //
    // The client gates one-tap logging on this field because a 200 without a
    // `conflict` key is ambiguous: it is also what a REFUSAL to compare returns.
    const label355 = {
      calories: 150,
      totalSugars: 39,
      totalFat: 0,
      saturatedFat: null,
      servingSize: "355 mL",
    };

    it("reports labelCompared true on the conflict branch", async () => {
      mockLookup.mockResolvedValue(cherryCokeDbResult());
      const res = await authedPost("/api/nutrition/barcode/06772408", {
        labelNutrition: label355,
      });
      expect(res.body.conflict).toBeDefined();
      // Must be present on this branch too — omitting it would gate a label that
      // was in fact used.
      expect(res.body.labelCompared).toBe(true);
    });

    it("reports labelCompared true when the label agrees", async () => {
      mockLookup.mockResolvedValue(correctCokeDbResult());
      const res = await authedPost("/api/nutrition/barcode/06772408", {
        labelNutrition: label355,
      });
      expect(res.body.conflict).toBeUndefined();
      expect(res.body.labelCompared).toBe(true);
    });

    it("reports labelCompared false when the serving does not parse, with the same 200 shape", async () => {
      mockLookup.mockResolvedValue(cherryCokeDbResult());
      const res = await authedPost("/api/nutrition/barcode/06772408", {
        labelNutrition: { ...label355, servingSize: "1 Can" },
      });
      expect(res.status).toBe(200);
      // Indistinguishable from agreement WITHOUT the flag — that ambiguity is
      // exactly what let the gate open on the un-compared Cherry Coke record.
      expect(res.body.conflict).toBeUndefined();
      expect(res.body.labelCompared).toBe(false);
    });

    // ── The lost-flag notice must name the RIGHT cause ──
    //
    // A nutrient warning can disappear from the label-corrected body for
    // reasons that are not the same sentence, and for one of them the original
    // copy ("its values didn't match the label") described a comparison that
    // never ran. Asserting only that A notice exists cannot catch that, so
    // every test below asserts the WORDING, and each asserts the absence of the
    // other cause's wording.
    const noticeDetail = (res: {
      body: {
        conflict: {
          label: {
            flags: {
              id: string;
              detail?: string;
            }[];
          };
        };
      };
    }) =>
      res.body.conflict.label.flags.find((f) => f.id === "nutrient-unavailable")
        ?.detail;

    it("blames the label-vs-record mismatch when the record's macros were BLANKED", async () => {
      mockLookup.mockResolvedValue(highSodiumDbResult()); // sodium 900 -> High in sodium
      const res = await authedPost("/api/nutrition/barcode/07100002", {
        labelNutrition: {
          calories: 100, // ×(100/85) = 118 per-100 vs the record's 450
          totalSugars: null,
          totalFat: null,
          saturatedFat: null,
          servingSize: "85 g",
        },
      });
      expect(res.status).toBe(200);
      // A CORROBORATING field disagreed, which is what makes the mismatch
      // wording true — the comparison it describes is the cause of the loss.
      expect(res.body.conflict.fields).toEqual(["calories"]);
      expect(
        res.body.flags.some((f: { id: string }) => f.id === "nutrient:sodium"),
      ).toBe(true);
      expect(
        res.body.conflict.label.flags.some(
          (f: { id: string }) => f.id === "nutrient:sodium",
        ),
      ).toBe(false);
      expect(noticeDetail(res)).toBe(
        "Our record flagged high in sodium, but the label's numbers didn't match our record's, so the record's other values weren't used and aren't shown for this scan.",
      );
    });

    it("blames the impossible reading when the value was dropped for CONTAINMENT", async () => {
      mockLookup.mockResolvedValue(misreadSatFatDbResult()); // saturatedFat 8 -> High in saturated fat
      const res = await authedPost("/api/nutrition/barcode/07100001", {
        labelNutrition: misreadSatFatLabel,
      });
      expect(res.status).toBe(200);
      // EXACTLY ["fat"], not arrayContaining: the whole point of this shape is
      // that saturatedFat was never compared (provenance named only totalFat),
      // so telling the user it "didn't match" would be a lie about a comparison
      // that did not happen. If `directReads` ever stopped reaching the service,
      // saturatedFat would join this list and the assertion would fail.
      expect(res.body.conflict.fields).toEqual(["fat"]);
      expect(
        res.body.flags.some(
          (f: { id: string }) => f.id === "nutrient:saturated_fat",
        ),
      ).toBe(true);
      expect(
        res.body.conflict.label.flags.some(
          (f: { id: string }) => f.id === "nutrient:saturated_fat",
        ),
      ).toBe(false);
      expect(noticeDetail(res)).toBe(
        "Our record flagged high in saturated fat, but this scan's saturated fat came out higher than its total fat, which can't be right, so that value isn't shown for this scan.",
      );
      // The distinguishing assertion: the blanking sentence must NOT appear.
      expect(noticeDetail(res)).not.toContain("didn't match");
    });

    it("says BOTH, in a fixed order, when one response loses a flag to each cause", async () => {
      mockLookup.mockResolvedValue(misreadSatFatSaltyDbResult());
      const res = await authedPost("/api/nutrition/barcode/07100001", {
        labelNutrition: misreadSatFatLabel,
      });
      expect(res.status).toBe(200);
      expect(noticeDetail(res)).toBe(
        "Our record flagged high in sodium, but the label's numbers didn't match our record's, so the record's other values weren't used and aren't shown for this scan. " +
          "Our record flagged high in saturated fat, but this scan's saturated fat came out higher than its total fat, which can't be right, so that value isn't shown for this scan.",
      );
    });

    it("says nothing when the flag went away because the LABEL's own reading is below the line", async () => {
      mockLookup.mockResolvedValue(wrongHighSugarDbResult()); // sugar 30 -> High in sugar
      const res = await authedPost("/api/nutrition/barcode/07100003", {
        labelNutrition: {
          calories: 200, // ×2 = 400 per-100 — agrees
          totalSugars: 4, // ×2 = 8 per-100 vs the record's 30
          totalFat: null,
          saturatedFat: null,
          servingSize: "50 g",
        },
      });
      expect(res.status).toBe(200);
      // Non-vacuity: the record DID raise the flag and the label body DID lose
      // it, so this exercises the suppression branch rather than a no-op.
      expect(
        res.body.flags.some((f: { id: string }) => f.id === "nutrient:sugar"),
      ).toBe(true);
      expect(
        res.body.conflict.label.flags.some(
          (f: { id: string }) => f.id === "nutrient:sugar",
        ),
      ).toBe(false);
      // ...but the value is right there on screen, so no cause applies. Any
      // notice here would tell the user a number they can see "isn't shown".
      expect(res.body.conflict.label.per100g.sugar).toBeCloseTo(8);
      expect(noticeDetail(res)).toBeUndefined();
    });
  });

  describe("GET /api/scanned-items/frequent", () => {
    it("returns frequent items with default limit", async () => {
      const mockFrequentItems = [
        {
          productName: "2 eggs and toast",
          logCount: 12,
          lastLogged: "2026-03-20T10:00:00.000Z",
        },
        {
          productName: "chicken salad",
          logCount: 8,
          lastLogged: "2026-03-19T12:00:00.000Z",
        },
      ];
      vi.mocked(storage.getFrequentItems).mockResolvedValue(mockFrequentItems);

      const res = await request(app)
        .get("/api/scanned-items/frequent")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(2);
      expect(res.body.items[0].productName).toBe("2 eggs and toast");
      expect(res.body.items[0].logCount).toBe(12);
      expect(res.body.items[0].lastLogged).toBe("2026-03-20T10:00:00.000Z");
      expect(storage.getFrequentItems).toHaveBeenCalledWith("1", 5);
    });

    it("respects custom limit parameter", async () => {
      vi.mocked(storage.getFrequentItems).mockResolvedValue([]);

      const res = await request(app)
        .get("/api/scanned-items/frequent?limit=10")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(storage.getFrequentItems).toHaveBeenCalledWith("1", 10);
    });

    it("clamps limit to max 20", async () => {
      vi.mocked(storage.getFrequentItems).mockResolvedValue([]);

      const res = await request(app)
        .get("/api/scanned-items/frequent?limit=50")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(storage.getFrequentItems).toHaveBeenCalledWith("1", 20);
    });

    it("returns empty array for users with no history", async () => {
      vi.mocked(storage.getFrequentItems).mockResolvedValue([]);

      const res = await request(app)
        .get("/api/scanned-items/frequent")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([]);
    });

    it("returns 500 on storage error", async () => {
      vi.mocked(storage.getFrequentItems).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .get("/api/scanned-items/frequent")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Failed to fetch frequent items");
    });
  });
});
