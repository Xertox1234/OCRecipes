import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import {
  lookupMicronutrientsWithCache,
  batchLookupMicronutrients,
  aggregateMicronutrients,
  getDailyValueReference,
} from "../../services/micronutrient-lookup";
import { register } from "../micronutrients";

vi.mock("../../storage", () => ({
  storage: {
    getSubscriptionStatus: vi.fn(),
    getScannedItem: vi.fn(),
    getDailyLogs: vi.fn(),
    getScannedItemsByIds: vi.fn(),
  },
}));

vi.mock("../../middleware/auth");

vi.mock("express-rate-limit");

vi.mock("../../services/micronutrient-lookup", () => ({
  lookupMicronutrientsWithCache: vi.fn(),
  batchLookupMicronutrients: vi.fn(),
  aggregateMicronutrients: vi.fn(),
  getDailyValueReference: vi.fn(),
}));

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

function mockPremium() {
  vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
    tier: "premium",
  } as never);
}

describe("Micronutrients Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  describe("GET /api/micronutrients/item/:id", () => {
    it("returns micronutrients for a scanned item", async () => {
      mockPremium();
      vi.mocked(storage.getScannedItem).mockResolvedValue({
        id: 1,
        userId: "1",
        productName: "Apple",
      } as never);
      const mockMicros = [
        {
          nutrientName: "Vitamin C",
          amount: 8,
          unit: "mg",
          percentDailyValue: 9,
        },
      ];
      vi.mocked(lookupMicronutrientsWithCache).mockResolvedValue(mockMicros);

      const res = await request(app)
        .get("/api/micronutrients/item/1")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.productName).toBe("Apple");
      expect(res.body.micronutrients).toHaveLength(1);
    });

    it("returns 404 when item not found", async () => {
      mockPremium();
      vi.mocked(storage.getScannedItem).mockResolvedValue(null as never);

      const res = await request(app)
        .get("/api/micronutrients/item/999")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(404);
    });

    it("returns 404 when item belongs to different user", async () => {
      mockPremium();
      vi.mocked(storage.getScannedItem).mockResolvedValue({
        id: 1,
        userId: "other-user",
        productName: "Apple",
      } as never);

      const res = await request(app)
        .get("/api/micronutrients/item/1")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(404);
    });

    it("returns 400 for invalid item ID", async () => {
      mockPremium();

      const res = await request(app)
        .get("/api/micronutrients/item/abc")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
    });

    it("returns 403 for free tier users", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue(null as never);

      const res = await request(app)
        .get("/api/micronutrients/item/1")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("PREMIUM_REQUIRED");
    });
  });

  describe("GET /api/micronutrients/daily", () => {
    it("returns aggregated daily micronutrient summary", async () => {
      mockPremium();
      vi.mocked(storage.getDailyLogs).mockResolvedValue([
        { scannedItemId: 1 },
        { scannedItemId: 2 },
      ] as never);
      vi.mocked(storage.getScannedItemsByIds).mockResolvedValue([
        { id: 1, productName: "Apple" },
        { id: 2, productName: "Banana" },
      ] as never);
      vi.mocked(batchLookupMicronutrients).mockResolvedValue([
        [
          {
            nutrientName: "Vitamin C",
            amount: 10,
            unit: "mg",
            percentDailyValue: 11,
          },
        ],
        [
          {
            nutrientName: "Vitamin C",
            amount: 5,
            unit: "mg",
            percentDailyValue: 6,
          },
        ],
      ]);
      vi.mocked(aggregateMicronutrients).mockReturnValue([
        {
          nutrientName: "Vitamin C",
          amount: 15,
          unit: "mg",
          percentDailyValue: 17,
        },
      ]);

      const res = await request(app)
        .get("/api/micronutrients/daily?date=2024-01-15")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.micronutrients).toHaveLength(1);
    });

    it("returns 403 for free tier", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue(null as never);

      const res = await request(app)
        .get("/api/micronutrients/daily")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("PREMIUM_REQUIRED");
    });
  });

  describe("GET /api/micronutrients/lookup", () => {
    it("returns micronutrients for valid food name", async () => {
      const mockMicros = [
        {
          nutrientName: "Vitamin C",
          amount: 4.6,
          unit: "mg",
          percentDailyValue: 5,
        },
      ];
      vi.mocked(lookupMicronutrientsWithCache).mockResolvedValue(mockMicros);

      const res = await request(app)
        .get("/api/micronutrients/lookup?name=chicken+breast")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.foodName).toBe("chicken breast");
      expect(res.body.micronutrients).toHaveLength(1);
      expect(res.body.micronutrients[0].nutrientName).toBe("Vitamin C");
      expect(lookupMicronutrientsWithCache).toHaveBeenCalledWith(
        "chicken breast",
      );
    });

    it("returns 400 for missing name param", async () => {
      const res = await request(app)
        .get("/api/micronutrients/lookup")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 for empty name param", async () => {
      const res = await request(app)
        .get("/api/micronutrients/lookup?name=")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });

    it("returns 500 when lookup service fails", async () => {
      vi.mocked(lookupMicronutrientsWithCache).mockRejectedValue(
        new Error("Service unavailable"),
      );

      const res = await request(app)
        .get("/api/micronutrients/lookup?name=chicken+breast")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
      expect(res.body.code).toBe("INTERNAL_ERROR");
    });
  });

  describe("GET /api/micronutrients/reference", () => {
    it("returns daily value reference data", async () => {
      const ref = { "Vitamin C": { unit: "mg", dailyValue: 90 } };
      vi.mocked(getDailyValueReference).mockReturnValue(ref);

      const res = await request(app)
        .get("/api/micronutrients/reference")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body["Vitamin C"]).toBeDefined();
    });
  });
});
