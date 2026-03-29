import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { generateFullRecipe } from "../../services/recipe-generation";
import {
  searchCatalogRecipes,
  getCatalogRecipeDetail,
} from "../../services/recipe-catalog";
import { importRecipeFromUrl } from "../../services/recipe-import";
import { register } from "../recipes";
import type { CommunityRecipe } from "@shared/schema";
import {
  createMockCommunityRecipe,
  createMockMealPlanRecipe,
} from "../../__tests__/factories";

vi.mock("../../storage", () => ({
  storage: {
    getSubscriptionStatus: vi.fn(),
    getFeaturedRecipes: vi.fn(),
    getUnifiedRecipes: vi.fn(),
    getCommunityRecipes: vi.fn(),
    getDailyRecipeGenerationCount: vi.fn(),
    getUserProfile: vi.fn(),
    createCommunityRecipe: vi.fn(),
    createRecipeWithLimitCheck: vi.fn(),
    logRecipeGeneration: vi.fn(),
    updateRecipePublicStatus: vi.fn(),
    getUserRecipes: vi.fn(),
    getCommunityRecipe: vi.fn(),
    deleteCommunityRecipe: vi.fn(),
    findMealPlanRecipeByExternalId: vi.fn(),
    createMealPlanRecipe: vi.fn(),
    getFrequentRecipesForMealType: vi.fn(),
  },
}));

vi.mock("../../services/recipe-generation", () => ({
  generateFullRecipe: vi.fn(),
  normalizeProductName: vi.fn((name: string) => name.toLowerCase()),
}));

vi.mock("../../services/recipe-catalog", () => ({
  searchCatalogRecipes: vi.fn(),
  getCatalogRecipeDetail: vi.fn(),
  CatalogQuotaError: class CatalogQuotaError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = "CatalogQuotaError";
    }
  },
}));

vi.mock("../../services/recipe-import", () => ({
  importRecipeFromUrl: vi.fn(),
}));

vi.mock("../../middleware/auth");

vi.mock("express-rate-limit");

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

const mockRecipe = createMockCommunityRecipe({
  id: 1,
  authorId: "1",
  title: "Pasta Primavera",
  isPublic: true,
});

describe("Recipes Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  describe("GET /api/recipes/featured", () => {
    it("returns featured recipes without authorId", async () => {
      vi.mocked(storage.getFeaturedRecipes).mockResolvedValue([mockRecipe]);

      const res = await request(app)
        .get("/api/recipes/featured")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body[0].title).toBe("Pasta Primavera");
      expect(res.body[0].authorId).toBeUndefined();
    });
  });

  describe("GET /api/recipes/browse", () => {
    it("returns unified recipes", async () => {
      vi.mocked(storage.getUnifiedRecipes).mockResolvedValue({
        community: [mockRecipe],
        personal: [],
      });

      const res = await request(app)
        .get("/api/recipes/browse?query=pasta")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.community).toHaveLength(1);
      expect(res.body.community[0].authorId).toBeUndefined();
    });

    it("returns frequent recipes when mealType provided", async () => {
      vi.mocked(storage.getUnifiedRecipes).mockResolvedValue({
        community: [],
        personal: [],
      });
      vi.mocked(storage.getFrequentRecipesForMealType).mockResolvedValue([
        createMockMealPlanRecipe({ id: 10, title: "Oatmeal" }),
      ]);

      const res = await request(app)
        .get("/api/recipes/browse?mealType=breakfast")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.frequent).toHaveLength(1);
      expect(res.body.frequent[0].title).toBe("Oatmeal");
      expect(storage.getFrequentRecipesForMealType).toHaveBeenCalledWith(
        "1",
        "breakfast",
      );
    });

    it("returns empty frequent when no mealType", async () => {
      vi.mocked(storage.getUnifiedRecipes).mockResolvedValue({
        community: [],
        personal: [],
      });

      const res = await request(app)
        .get("/api/recipes/browse")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.frequent).toEqual([]);
      expect(storage.getFrequentRecipesForMealType).not.toHaveBeenCalled();
    });

    it("passes mealType to getUnifiedRecipes", async () => {
      vi.mocked(storage.getUnifiedRecipes).mockResolvedValue({
        community: [],
        personal: [],
      });
      vi.mocked(storage.getFrequentRecipesForMealType).mockResolvedValue([]);

      await request(app)
        .get("/api/recipes/browse?mealType=breakfast")
        .set("Authorization", "Bearer token");

      expect(storage.getUnifiedRecipes).toHaveBeenCalledWith(
        expect.objectContaining({ mealType: "breakfast" }),
      );
    });

    it("rejects invalid mealType", async () => {
      const res = await request(app)
        .get("/api/recipes/browse?mealType=brunch")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/recipes/community", () => {
    it("returns community recipes", async () => {
      vi.mocked(storage.getCommunityRecipes).mockResolvedValue([mockRecipe]);

      const res = await request(app)
        .get("/api/recipes/community?productName=pasta")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });

    it("returns 400 without productName", async () => {
      const res = await request(app)
        .get("/api/recipes/community")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/recipes/generation-status", () => {
    it("returns generation status", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "premium",
        expiresAt: null,
      });
      vi.mocked(storage.getDailyRecipeGenerationCount).mockResolvedValue(2);

      const res = await request(app)
        .get("/api/recipes/generation-status")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.generationsToday).toBe(2);
      expect(res.body.canGenerate).toBeDefined();
    });
  });

  describe("POST /api/recipes/generate", () => {
    it("generates a recipe for premium users", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "premium",
        expiresAt: null,
      });
      vi.mocked(storage.getDailyRecipeGenerationCount).mockResolvedValue(0);
      vi.mocked(storage.getUserProfile).mockResolvedValue(undefined);
      vi.mocked(generateFullRecipe).mockResolvedValue({
        title: "Pasta Bowl",
        description: "Delicious",
        difficulty: "Easy",
        timeEstimate: "30 min",
        dietTags: [],
        instructions: "Cook pasta...",
        imageUrl: null,
      });
      vi.mocked(storage.createRecipeWithLimitCheck).mockResolvedValue(
        createMockCommunityRecipe({ id: 2, title: "Pasta Bowl" }),
      );

      const res = await request(app)
        .post("/api/recipes/generate")
        .set("Authorization", "Bearer token")
        .send({ productName: "Pasta" });

      expect(res.status).toBe(201);
    });

    it("returns 403 for free tier", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "free",
        expiresAt: null,
      });

      const res = await request(app)
        .post("/api/recipes/generate")
        .set("Authorization", "Bearer token")
        .send({ productName: "Pasta" });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("PREMIUM_REQUIRED");
    });

    it("returns 429 when daily limit reached", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "premium",
        expiresAt: null,
      });
      vi.mocked(storage.getDailyRecipeGenerationCount).mockResolvedValue(100);

      const res = await request(app)
        .post("/api/recipes/generate")
        .set("Authorization", "Bearer token")
        .send({ productName: "Pasta" });

      expect(res.status).toBe(429);
    });

    it("returns 400 for missing productName", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "premium",
        expiresAt: null,
      });
      vi.mocked(storage.getDailyRecipeGenerationCount).mockResolvedValue(0);

      const res = await request(app)
        .post("/api/recipes/generate")
        .set("Authorization", "Bearer token")
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/recipes/:id/share", () => {
    it("shares a recipe", async () => {
      vi.mocked(storage.updateRecipePublicStatus).mockResolvedValue(
        createMockCommunityRecipe({ ...mockRecipe, isPublic: true }),
      );

      const res = await request(app)
        .post("/api/recipes/1/share")
        .set("Authorization", "Bearer token")
        .send({ isPublic: true });

      expect(res.status).toBe(200);
    });

    it("returns 404 for unowned recipe", async () => {
      vi.mocked(storage.updateRecipePublicStatus).mockResolvedValue(undefined);

      const res = await request(app)
        .post("/api/recipes/1/share")
        .set("Authorization", "Bearer token")
        .send({ isPublic: true });

      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/recipes/mine", () => {
    it("returns user's recipes", async () => {
      vi.mocked(storage.getUserRecipes).mockResolvedValue([
        mockRecipe,
      ] as unknown as { items: CommunityRecipe[]; total: number });

      const res = await request(app)
        .get("/api/recipes/mine")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });
  });

  describe("GET /api/recipes/:id", () => {
    it("returns a public recipe", async () => {
      vi.mocked(storage.getCommunityRecipe).mockResolvedValue(mockRecipe);

      const res = await request(app)
        .get("/api/recipes/1")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.authorId).toBeUndefined();
    });

    it("returns 404 for private recipe of another user", async () => {
      vi.mocked(storage.getCommunityRecipe).mockResolvedValue(
        createMockCommunityRecipe({
          ...mockRecipe,
          authorId: "2",
          isPublic: false,
        }),
      );

      const res = await request(app)
        .get("/api/recipes/1")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(404);
    });

    it("returns own private recipe", async () => {
      vi.mocked(storage.getCommunityRecipe).mockResolvedValue(
        createMockCommunityRecipe({ ...mockRecipe, isPublic: false }),
      );

      const res = await request(app)
        .get("/api/recipes/1")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
    });
  });

  describe("DELETE /api/recipes/:id", () => {
    it("deletes own recipe", async () => {
      vi.mocked(storage.deleteCommunityRecipe).mockResolvedValue(true);

      const res = await request(app)
        .delete("/api/recipes/1")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(204);
    });

    it("returns 404 for unowned recipe", async () => {
      vi.mocked(storage.deleteCommunityRecipe).mockResolvedValue(false);

      const res = await request(app)
        .delete("/api/recipes/999")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/meal-plan/catalog/search", () => {
    it("searches catalog recipes", async () => {
      vi.mocked(searchCatalogRecipes).mockResolvedValue({
        results: [],
        offset: 0,
        number: 10,
        totalResults: 0,
      });

      const res = await request(app)
        .get("/api/meal-plan/catalog/search?query=chicken")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
    });

    it("returns 400 for missing query", async () => {
      const res = await request(app)
        .get("/api/meal-plan/catalog/search")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/meal-plan/catalog/:id", () => {
    it("returns catalog recipe detail", async () => {
      vi.mocked(getCatalogRecipeDetail).mockResolvedValue({
        recipe: createMockMealPlanRecipe({ title: "Chicken" }),
        ingredients: [],
      });

      const res = await request(app)
        .get("/api/meal-plan/catalog/123")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
    });

    it("returns 404 when not found", async () => {
      vi.mocked(getCatalogRecipeDetail).mockResolvedValue(null);

      const res = await request(app)
        .get("/api/meal-plan/catalog/999")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/meal-plan/catalog/:id/save", () => {
    it("saves a catalog recipe", async () => {
      vi.mocked(storage.findMealPlanRecipeByExternalId).mockResolvedValue(
        undefined,
      );
      vi.mocked(getCatalogRecipeDetail).mockResolvedValue({
        recipe: createMockMealPlanRecipe({ title: "Chicken" }),
        ingredients: [],
      });
      vi.mocked(storage.createMealPlanRecipe).mockResolvedValue(
        createMockMealPlanRecipe({ id: 1, title: "Chicken" }),
      );

      const res = await request(app)
        .post("/api/meal-plan/catalog/123/save")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(201);
    });

    it("returns existing recipe if already saved", async () => {
      vi.mocked(storage.findMealPlanRecipeByExternalId).mockResolvedValue(
        createMockMealPlanRecipe({ id: 1, title: "Chicken" }),
      );

      const res = await request(app)
        .post("/api/meal-plan/catalog/123/save")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(1);
    });
  });

  describe("Error paths", () => {
    it("GET /api/recipes/featured returns 500 on storage error", async () => {
      vi.mocked(storage.getFeaturedRecipes).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .get("/api/recipes/featured")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
    });

    it("GET /api/recipes/browse returns 500 on storage error", async () => {
      vi.mocked(storage.getUnifiedRecipes).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .get("/api/recipes/browse")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
    });

    it("GET /api/recipes/community returns 500 on storage error", async () => {
      vi.mocked(storage.getCommunityRecipes).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .get("/api/recipes/community?productName=pasta")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
    });

    it("GET /api/recipes/generation-status returns 500 on storage error", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "premium",
        expiresAt: null,
      });
      vi.mocked(storage.getDailyRecipeGenerationCount).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .get("/api/recipes/generation-status")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
    });

    it("POST /api/recipes/generate returns 500 on generation error", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "premium",
        expiresAt: null,
      });
      vi.mocked(storage.getDailyRecipeGenerationCount).mockResolvedValue(0);
      vi.mocked(storage.getUserProfile).mockResolvedValue(undefined);
      vi.mocked(generateFullRecipe).mockRejectedValue(new Error("AI error"));

      const res = await request(app)
        .post("/api/recipes/generate")
        .set("Authorization", "Bearer token")
        .send({ productName: "Pasta" });

      expect(res.status).toBe(500);
    });

    it("POST /api/recipes/:id/share returns 400 for invalid ID", async () => {
      const res = await request(app)
        .post("/api/recipes/abc/share")
        .set("Authorization", "Bearer token")
        .send({ isPublic: true });

      expect(res.status).toBe(400);
    });

    it("POST /api/recipes/:id/share returns 400 for invalid body", async () => {
      const res = await request(app)
        .post("/api/recipes/1/share")
        .set("Authorization", "Bearer token")
        .send({});

      expect(res.status).toBe(400);
    });

    it("POST /api/recipes/:id/share returns 500 on storage error", async () => {
      vi.mocked(storage.updateRecipePublicStatus).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .post("/api/recipes/1/share")
        .set("Authorization", "Bearer token")
        .send({ isPublic: true });

      expect(res.status).toBe(500);
    });

    it("GET /api/recipes/mine returns 500 on storage error", async () => {
      vi.mocked(storage.getUserRecipes).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .get("/api/recipes/mine")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
    });

    it("GET /api/recipes/:id returns 400 for invalid ID", async () => {
      const res = await request(app)
        .get("/api/recipes/abc")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
    });

    it("GET /api/recipes/:id returns 404 for nonexistent recipe", async () => {
      vi.mocked(storage.getCommunityRecipe).mockResolvedValue(undefined);

      const res = await request(app)
        .get("/api/recipes/999")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(404);
    });

    it("GET /api/recipes/:id returns 500 on storage error", async () => {
      vi.mocked(storage.getCommunityRecipe).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .get("/api/recipes/1")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
    });

    it("DELETE /api/recipes/:id returns 400 for invalid ID", async () => {
      const res = await request(app)
        .delete("/api/recipes/abc")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
    });

    it("DELETE /api/recipes/:id returns 500 on storage error", async () => {
      vi.mocked(storage.deleteCommunityRecipe).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .delete("/api/recipes/1")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
    });

    it("GET /api/meal-plan/catalog/search returns 500 on service error", async () => {
      vi.mocked(searchCatalogRecipes).mockRejectedValue(
        new Error("Service error"),
      );

      const res = await request(app)
        .get("/api/meal-plan/catalog/search?query=chicken")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
    });

    it("GET /api/meal-plan/catalog/:id returns 400 for invalid ID", async () => {
      const res = await request(app)
        .get("/api/meal-plan/catalog/abc")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
    });

    it("GET /api/meal-plan/catalog/:id returns 500 on service error", async () => {
      vi.mocked(getCatalogRecipeDetail).mockRejectedValue(
        new Error("Service error"),
      );

      const res = await request(app)
        .get("/api/meal-plan/catalog/123")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
    });

    it("POST /api/meal-plan/catalog/:id/save returns 400 for invalid ID", async () => {
      const res = await request(app)
        .post("/api/meal-plan/catalog/abc/save")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
    });

    it("POST /api/meal-plan/catalog/:id/save returns 404 when not found in catalog", async () => {
      vi.mocked(storage.findMealPlanRecipeByExternalId).mockResolvedValue(
        undefined,
      );
      vi.mocked(getCatalogRecipeDetail).mockResolvedValue(null);

      const res = await request(app)
        .post("/api/meal-plan/catalog/999/save")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(404);
    });

    it("POST /api/meal-plan/catalog/:id/save returns 500 on service error", async () => {
      vi.mocked(storage.findMealPlanRecipeByExternalId).mockResolvedValue(
        undefined,
      );
      vi.mocked(getCatalogRecipeDetail).mockRejectedValue(
        new Error("Service error"),
      );

      const res = await request(app)
        .post("/api/meal-plan/catalog/123/save")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
    });
  });

  describe("POST /api/meal-plan/recipes/import-url", () => {
    it("imports recipe from URL", async () => {
      vi.mocked(importRecipeFromUrl).mockResolvedValue({
        success: true,
        data: {
          title: "Imported Recipe",
          description: "A recipe",
          sourceUrl: "https://example.com/recipe",
          cuisine: null,
          servings: 4,
          prepTimeMinutes: 10,
          cookTimeMinutes: 20,
          imageUrl: null,
          instructions: "Cook it",
          dietTags: [],
          caloriesPerServing: null,
          proteinPerServing: null,
          carbsPerServing: null,
          fatPerServing: null,
          ingredients: [{ name: "Flour", quantity: "2", unit: "cups" }],
        },
      });
      vi.mocked(storage.createMealPlanRecipe).mockResolvedValue(
        createMockMealPlanRecipe({ id: 1, title: "Imported Recipe" }),
      );

      const res = await request(app)
        .post("/api/meal-plan/recipes/import-url")
        .set("Authorization", "Bearer token")
        .send({ url: "https://example.com/recipe" });

      expect(res.status).toBe(201);
    });

    it("returns 422 for failed import", async () => {
      vi.mocked(importRecipeFromUrl).mockResolvedValue({
        success: false,
        error: "FETCH_FAILED",
      });

      const res = await request(app)
        .post("/api/meal-plan/recipes/import-url")
        .set("Authorization", "Bearer token")
        .send({ url: "https://example.com/bad" });

      expect(res.status).toBe(422);
    });

    it("returns 400 for invalid URL", async () => {
      const res = await request(app)
        .post("/api/meal-plan/recipes/import-url")
        .set("Authorization", "Bearer token")
        .send({ url: "not-a-url" });

      expect(res.status).toBe(400);
    });

    it("returns 500 on import service error", async () => {
      vi.mocked(importRecipeFromUrl).mockRejectedValue(
        new Error("Service error"),
      );

      const res = await request(app)
        .post("/api/meal-plan/recipes/import-url")
        .set("Authorization", "Bearer token")
        .send({ url: "https://example.com/recipe" });

      expect(res.status).toBe(500);
    });

    it("returns 422 for unknown error code", async () => {
      vi.mocked(importRecipeFromUrl).mockResolvedValue({
        success: false,
        // Intentionally use an unrecognized error code to test the fallback message path
        error: "UNKNOWN_ERROR" as "FETCH_FAILED",
      });

      const res = await request(app)
        .post("/api/meal-plan/recipes/import-url")
        .set("Authorization", "Bearer token")
        .send({ url: "https://example.com/bad" });

      expect(res.status).toBe(422);
      expect(res.body.error).toBe("Import failed");
    });
  });
});
