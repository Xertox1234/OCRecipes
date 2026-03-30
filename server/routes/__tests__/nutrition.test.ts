import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import {
  lookupNutrition,
  lookupBarcode,
} from "../../services/nutrition-lookup";
import type { BarcodeLookupResult } from "../../services/nutrition-lookup";
import { register } from "../nutrition";
import {
  createMockScannedItem,
  createMockNutritionData,
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
    createScannedItemWithLog: vi.fn(),
  },
}));

vi.mock("../../middleware/auth");

vi.mock("express-rate-limit");

vi.mock("../../services/nutrition-lookup", () => ({
  lookupNutrition: vi.fn(),
  lookupBarcode: vi.fn(),
}));

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
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
