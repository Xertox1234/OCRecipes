import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { storage } from "../../storage";
import { register } from "../public-api";
import { createMockCommunityRecipe } from "../../__tests__/factories";

vi.mock("../../storage", () => ({
  storage: {
    getApiKeyByPrefix: vi.fn(),
    getApiKeyUsage: vi.fn(),
    incrementApiKeyUsage: vi.fn(),
    getVerificationByBarcodes: vi.fn(),
    getBarcodeNutrition: vi.fn(),
    getCuratedRecipes: vi.fn(),
    getCuratedRecipeById: vi.fn(),
  },
}));

// Configurable tier for the mock
let mockTier = "free";

vi.mock("../../middleware/api-key-auth", () => ({
  requireApiKey: (
    req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => {
    req.apiKeyId = 1;
    req.apiKeyTier = mockTier;
    next();
  },
  invalidateApiKeyCache: vi.fn(),
  clearApiKeyCache: vi.fn(),
}));

vi.mock("../../middleware/api-rate-limit");

function createApp(tier = "free") {
  mockTier = tier;
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

describe("Public API Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  describe("GET /api/v1/products/:barcode", () => {
    it("returns beta header on all responses", async () => {
      vi.mocked(storage.getBarcodeNutrition).mockResolvedValue(null);
      vi.mocked(storage.getVerificationByBarcodes).mockResolvedValue(null);

      const res = await request(app).get("/api/v1/products/012345678901");
      expect(res.headers["x-api-status"]).toBe("beta");
    });

    it("returns CORS headers", async () => {
      vi.mocked(storage.getBarcodeNutrition).mockResolvedValue(null);

      const res = await request(app).get("/api/v1/products/012345678901");
      expect(res.headers["access-control-allow-origin"]).toBe("*");
    });

    it("returns rate limit headers", async () => {
      vi.mocked(storage.getBarcodeNutrition).mockResolvedValue(null);

      const res = await request(app).get("/api/v1/products/012345678901");
      expect(res.headers["x-ratelimit-limit"]).toBeDefined();
      expect(res.headers["x-ratelimit-remaining"]).toBeDefined();
      expect(res.headers["x-ratelimit-reset"]).toBeDefined();
    });

    describe("barcode validation", () => {
      it("rejects non-numeric barcodes", async () => {
        const res = await request(app).get("/api/v1/products/abc123");
        expect(res.status).toBe(400);
        expect(res.body.code).toBe("VALIDATION_ERROR");
      });

      it("rejects too-short barcodes", async () => {
        const res = await request(app).get("/api/v1/products/1234567");
        expect(res.status).toBe(400);
        expect(res.body.code).toBe("VALIDATION_ERROR");
      });

      it("rejects too-long barcodes", async () => {
        const res = await request(app).get("/api/v1/products/123456789012345");
        expect(res.status).toBe(400);
        expect(res.body.code).toBe("VALIDATION_ERROR");
      });

      it("accepts valid 12-digit UPC-A", async () => {
        vi.mocked(storage.getBarcodeNutrition).mockResolvedValue(null);
        const res = await request(app).get("/api/v1/products/012345678901");
        // Should not get a validation error
        expect(res.status).not.toBe(400);
      });

      it("accepts valid 13-digit EAN-13", async () => {
        vi.mocked(storage.getBarcodeNutrition).mockResolvedValue(null);
        const res = await request(app).get("/api/v1/products/0123456789012");
        expect(res.status).not.toBe(400);
      });

      it("accepts valid 8-digit EAN-8", async () => {
        vi.mocked(storage.getBarcodeNutrition).mockResolvedValue(null);
        const res = await request(app).get("/api/v1/products/12345678");
        expect(res.status).not.toBe(400);
      });
    });

    describe("free tier (default mock tier)", () => {
      it("returns unverified nutrition data when found", async () => {
        vi.mocked(storage.getBarcodeNutrition).mockResolvedValue({
          id: 1,
          barcode: "012345678901",
          productName: "Test Cereal",
          brandName: "TestBrand",
          servingSize: "30g",
          calories: "120.00",
          protein: "3.00",
          carbs: "24.00",
          fat: "1.50",
          source: "usda",
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        const res = await request(app).get("/api/v1/products/012345678901");
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({
          barcode: "012345678901",
          productName: "Test Cereal",
          brandName: "TestBrand",
          servingSize: "30g",
          calories: 120,
          protein: 3,
          carbs: 24,
          fat: 1.5,
          source: "usda",
          verified: false,
        });
      });

      it("returns 404 when product not found", async () => {
        vi.mocked(storage.getBarcodeNutrition).mockResolvedValue(null);

        const res = await request(app).get("/api/v1/products/012345678901");
        expect(res.status).toBe(404);
        expect(res.body.code).toBe("NOT_FOUND");
      });

      it("does not query verified data for free tier", async () => {
        vi.mocked(storage.getBarcodeNutrition).mockResolvedValue(null);

        await request(app).get("/api/v1/products/012345678901");

        // Free tier (includesVerified: false) should NOT call getVerificationByBarcodes
        expect(storage.getVerificationByBarcodes).not.toHaveBeenCalled();
      });

      it("coerces decimal strings to numbers", async () => {
        vi.mocked(storage.getBarcodeNutrition).mockResolvedValue({
          id: 1,
          barcode: "012345678901",
          productName: null,
          brandName: null,
          servingSize: null,
          calories: "99.99",
          protein: "0.50",
          carbs: null,
          fat: null,
          source: "cnf",
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        const res = await request(app).get("/api/v1/products/012345678901");
        expect(res.body.data.calories).toBe(99.99);
        expect(res.body.data.protein).toBe(0.5);
        expect(res.body.data.carbs).toBeNull();
        expect(res.body.data.fat).toBeNull();
      });
    });

    describe("paid tier", () => {
      beforeEach(() => {
        app = createApp("starter");
      });

      it("returns verified data when available", async () => {
        vi.mocked(storage.getVerificationByBarcodes).mockResolvedValue({
          id: 1,
          barcode: "012345678901",
          verificationLevel: "verified",
          verificationCount: 3,
          consensusNutritionData: {
            calories: 120,
            protein: 3,
            carbs: 24,
            fat: 1.5,
          },
          frontLabelData: {
            brand: "TestBrand",
            productName: "Test Cereal",
            netWeight: "350g",
            claims: ["Whole Grain", "No Added Sugar"],
            scannedByUserId: 42,
            scannedAt: "2026-03-15T10:00:00Z",
          },
          createdAt: new Date("2026-03-10"),
          updatedAt: new Date("2026-03-15"),
        });

        const res = await request(app).get("/api/v1/products/012345678901");
        expect(res.status).toBe(200);

        const data = res.body.data;
        expect(data.verified).toBe(true);
        expect(data.verificationLevel).toBe("verified");
        expect(data.verificationCount).toBe(3);
        expect(data.frontLabel).toEqual({
          brand: "TestBrand",
          productName: "Test Cereal",
          netWeight: "350g",
          claims: ["Whole Grain", "No Added Sugar"],
        });
      });

      it("never exposes scannedByUserId in response", async () => {
        vi.mocked(storage.getVerificationByBarcodes).mockResolvedValue({
          id: 1,
          barcode: "012345678901",
          verificationLevel: "verified",
          verificationCount: 3,
          consensusNutritionData: {
            calories: 100,
            protein: 5,
            carbs: 20,
            fat: 2,
          },
          frontLabelData: {
            brand: "Brand",
            productName: "Product",
            netWeight: "100g",
            claims: [],
            scannedByUserId: 99,
            scannedAt: "2026-03-15T10:00:00Z",
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        const res = await request(app).get("/api/v1/products/012345678901");
        const json = JSON.stringify(res.body);

        expect(json).not.toContain("scannedByUserId");
        expect(json).not.toContain("scannedAt");
        expect(json).not.toContain('"99"');
      });

      it("falls back to unverified data when no verification exists", async () => {
        vi.mocked(storage.getVerificationByBarcodes).mockResolvedValue(null);
        vi.mocked(storage.getBarcodeNutrition).mockResolvedValue({
          id: 1,
          barcode: "012345678901",
          productName: "Fallback Product",
          brandName: null,
          servingSize: null,
          calories: "200.00",
          protein: "10.00",
          carbs: "30.00",
          fat: "5.00",
          source: "openfoodfacts",
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        const res = await request(app).get("/api/v1/products/012345678901");
        expect(res.status).toBe(200);
        expect(res.body.data.verified).toBe(false);
        expect(res.body.data.source).toBe("openfoodfacts");
      });

      it("handles null frontLabelData gracefully", async () => {
        vi.mocked(storage.getVerificationByBarcodes).mockResolvedValue({
          id: 1,
          barcode: "012345678901",
          verificationLevel: "single_verified",
          verificationCount: 1,
          consensusNutritionData: null,
          frontLabelData: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        const res = await request(app).get("/api/v1/products/012345678901");
        expect(res.status).toBe(200);
        expect(res.body.data.frontLabel).toBeNull();
        expect(res.body.data.calories).toBeNull();
      });
    });
  });

  describe("GET /api/v1/recipes", () => {
    it("returns empty list when no curated recipes exist", async () => {
      vi.mocked(storage.getCuratedRecipes).mockResolvedValue([]);
      const res = await request(app).get("/api/v1/recipes");
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it("returns serialized curated recipes", async () => {
      const mockRecipe = createMockCommunityRecipe({
        id: 42,
        title: "Chicken Tikka",
        isCanonical: true,
        canonicalImages: ["https://cdn.example.com/hero.jpg"],
      });
      vi.mocked(storage.getCuratedRecipes).mockResolvedValue([mockRecipe]);
      const res = await request(app).get("/api/v1/recipes");
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe(42);
      expect(res.body.data[0].title).toBe("Chicken Tikka");
    });
  });

  describe("GET /api/v1/recipes/:id", () => {
    it("returns 400 for non-integer id", async () => {
      const res = await request(app).get("/api/v1/recipes/abc");
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });

    it("returns 404 when recipe not found", async () => {
      vi.mocked(storage.getCuratedRecipeById).mockResolvedValue(null);
      const res = await request(app).get("/api/v1/recipes/99");
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
    });

    it("returns serialized recipe when found", async () => {
      const mockRecipe = createMockCommunityRecipe({
        id: 99,
        title: "Pasta Primavera",
        isCanonical: true,
      });
      vi.mocked(storage.getCuratedRecipeById).mockResolvedValue(mockRecipe);
      const res = await request(app).get("/api/v1/recipes/99");
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(99);
      expect(res.body.data.title).toBe("Pasta Primavera");
    });
  });
});
