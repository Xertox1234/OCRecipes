import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../../storage", () => ({
  storage: {
    getScannedItems: vi.fn(),
    getScannedItem: vi.fn(),
    getScannedItemWithFavourite: vi.fn(),
    getFavouriteScannedItems: vi.fn(),
    softDeleteScannedItem: vi.fn(),
    toggleFavouriteScannedItem: vi.fn(),
    getDailySummary: vi.fn(),
    getConfirmedMealPlanItemIds: vi.fn(),
    getPlannedNutritionSummary: vi.fn(),
  },
}));

vi.mock("../../middleware/auth", () => ({
  requireAuth: (
    req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => {
    req.userId = "1";
    next();
  },
}));

vi.mock("express-rate-limit", () => ({
  rateLimit: () =>
    (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
      next(),
  default: () =>
    (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
      next(),
}));

vi.mock("../../services/nutrition-lookup", () => ({
  lookupNutrition: vi.fn(),
  lookupBarcode: vi.fn(),
}));

// Mock db to prevent actual DB connection
vi.mock("../../db", () => ({
  db: {
    transaction: vi.fn(),
  },
}));

import { storage } from "../../storage";
import { lookupNutrition, lookupBarcode } from "../../services/nutrition-lookup";
import { register } from "../nutrition";

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

const mockScannedItem = {
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
  createdAt: new Date("2024-01-15T12:00:00"),
};

describe("Nutrition Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    app = createApp();
  });

  describe("GET /api/nutrition/lookup", () => {
    it("returns nutrition data for a valid name", async () => {
      vi.mocked(lookupNutrition).mockResolvedValue({
        calories: 165,
        protein: 31,
        carbs: 0,
        fat: 3.6,
        source: "usda",
      } as never);

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
      vi.mocked(lookupNutrition).mockResolvedValue(null as never);

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
        calories: 120,
        protein: 18,
      } as never);

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
      vi.mocked(lookupBarcode).mockResolvedValue(null as never);

      const res = await request(app)
        .get("/api/nutrition/barcode/9999999999")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_IN_DATABASE");
    });
  });

  describe("GET /api/scanned-items", () => {
    it("returns scanned items list", async () => {
      vi.mocked(storage.getScannedItems).mockResolvedValue([mockScannedItem] as never);

      const res = await request(app)
        .get("/api/scanned-items")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].productName).toBe("Greek Yogurt");
    });

    it("respects limit and offset parameters", async () => {
      vi.mocked(storage.getScannedItems).mockResolvedValue([] as never);

      await request(app)
        .get("/api/scanned-items?limit=10&offset=5")
        .set("Authorization", "Bearer token");

      expect(storage.getScannedItems).toHaveBeenCalledWith("1", 10, 5);
    });
  });

  describe("GET /api/scanned-items/favourites", () => {
    it("returns favourite scanned items", async () => {
      vi.mocked(storage.getFavouriteScannedItems).mockResolvedValue(
        [mockScannedItem] as never,
      );

      const res = await request(app)
        .get("/api/scanned-items/favourites")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });
  });

  describe("GET /api/scanned-items/:id", () => {
    it("returns a scanned item by ID", async () => {
      vi.mocked(storage.getScannedItemWithFavourite).mockResolvedValue(
        mockScannedItem as never,
      );

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
      } as never);

      const res = await request(app)
        .get("/api/scanned-items/1")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(404);
    });

    it("returns 400 for invalid ID", async () => {
      const res = await request(app)
        .get("/api/scanned-items/abc")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/scanned-items/:id/favourite", () => {
    it("toggles favourite status", async () => {
      vi.mocked(storage.getScannedItem).mockResolvedValue(mockScannedItem as never);
      vi.mocked(storage.toggleFavouriteScannedItem).mockResolvedValue(true as never);

      const res = await request(app)
        .post("/api/scanned-items/1/favourite")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.isFavourited).toBe(true);
    });

    it("returns 404 for non-existent item", async () => {
      vi.mocked(storage.getScannedItem).mockResolvedValue(null as never);

      const res = await request(app)
        .post("/api/scanned-items/999/favourite")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(404);
    });

    it("returns 404 for item owned by another user", async () => {
      vi.mocked(storage.getScannedItem).mockResolvedValue({
        ...mockScannedItem,
        userId: "2",
      } as never);

      const res = await request(app)
        .post("/api/scanned-items/1/favourite")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/scanned-items/:id", () => {
    it("soft deletes a scanned item", async () => {
      vi.mocked(storage.softDeleteScannedItem).mockResolvedValue(true as never);

      const res = await request(app)
        .delete("/api/scanned-items/1")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(204);
    });

    it("returns 404 for non-existent item", async () => {
      vi.mocked(storage.softDeleteScannedItem).mockResolvedValue(false as never);

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
  });

  describe("GET /api/daily-summary", () => {
    it("returns daily summary for today", async () => {
      const mockSummary = {
        totalCalories: 1500,
        totalProtein: 100,
        totalCarbs: 200,
        totalFat: 50,
        items: [],
      };
      vi.mocked(storage.getDailySummary).mockResolvedValue(mockSummary as never);
      vi.mocked(storage.getConfirmedMealPlanItemIds).mockResolvedValue([] as never);
      vi.mocked(storage.getPlannedNutritionSummary).mockResolvedValue({
        plannedCalories: 0,
      } as never);

      const res = await request(app)
        .get("/api/daily-summary")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.totalCalories).toBe(1500);
      expect(res.body).toHaveProperty("confirmedMealPlanItemIds");
    });

    it("accepts date parameter", async () => {
      vi.mocked(storage.getDailySummary).mockResolvedValue({} as never);
      vi.mocked(storage.getConfirmedMealPlanItemIds).mockResolvedValue([] as never);
      vi.mocked(storage.getPlannedNutritionSummary).mockResolvedValue({} as never);

      const res = await request(app)
        .get("/api/daily-summary?date=2024-01-15")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
    });
  });
});
