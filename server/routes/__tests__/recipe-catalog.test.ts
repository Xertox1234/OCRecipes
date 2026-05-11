import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import {
  searchCatalogRecipes,
  getCatalogRecipeDetail,
} from "../../services/recipe-catalog";
import { requireAuth } from "../../middleware/auth";
import { register } from "../recipe-catalog";
import {
  createMockMealPlanRecipe,
  createMockUser,
} from "../../__tests__/factories";

vi.mock("express-rate-limit");

vi.mock("../../storage", () => ({
  storage: {
    getSubscriptionStatus: vi.fn(),
    getUserProfile: vi.fn(),
    findMealPlanRecipeByExternalId: vi.fn(),
    createMealPlanRecipe: vi.fn(),
  },
}));

vi.mock("../../services/recipe-catalog", async () => {
  const actual = await vi.importActual<
    typeof import("../../services/recipe-catalog")
  >("../../services/recipe-catalog");
  return {
    ...actual,
    searchCatalogRecipes: vi.fn(),
    getCatalogRecipeDetail: vi.fn(),
  };
});

vi.mock("../../middleware/auth");

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

function setUserTier(tier: "premium" | "free") {
  const user = createMockUser({ subscriptionTier: tier });
  vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
    tier,
    expiresAt: user.subscriptionExpiresAt,
  });
}

describe("recipe-catalog routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
    setUserTier("premium");
    vi.mocked(storage.getUserProfile).mockResolvedValue(undefined);
  });

  it("returns 429 when rate limiter blocks the route", async () => {
    vi.resetModules();
    const limiter = vi.fn(
      () => (_req: unknown, res: { sendStatus: (code: number) => void }) => {
        res.sendStatus(429);
      },
    );

    vi.doMock("express-rate-limit", () => ({
      rateLimit: limiter,
      default: limiter,
    }));
    vi.doMock("../../middleware/auth", () => ({
      requireAuth: (
        req: { userId?: string },
        _res: unknown,
        next: () => void,
      ) => {
        req.userId = "1";
        next();
      },
    }));
    vi.doMock("../../storage", () => ({
      storage: {
        getSubscriptionStatus: vi
          .fn()
          .mockResolvedValue({ tier: "premium", expiresAt: null }),
        getUserProfile: vi.fn().mockResolvedValue(undefined),
        findMealPlanRecipeByExternalId: vi.fn(),
        createMealPlanRecipe: vi.fn(),
      },
    }));
    vi.doMock("../../services/recipe-catalog", async () => {
      const actual = await vi.importActual<
        typeof import("../../services/recipe-catalog")
      >("../../services/recipe-catalog");
      return {
        ...actual,
        searchCatalogRecipes: vi.fn(),
        getCatalogRecipeDetail: vi.fn(),
      };
    });

    const expressModule = await import("express");
    const supertestModule = await import("supertest");
    const routeModule = await import("../recipe-catalog");
    const rateLimitedApp = expressModule.default();
    rateLimitedApp.use(expressModule.default.json());
    routeModule.register(rateLimitedApp);

    const res = await supertestModule
      .default(rateLimitedApp)
      .get("/api/meal-plan/catalog/search?query=chicken");

    expect(res.status).toBe(429);
    vi.resetModules();
  });

  describe("GET /api/meal-plan/catalog/search", () => {
    it("returns 401 when auth middleware rejects", async () => {
      vi.mocked(requireAuth).mockImplementationOnce(async (_req, res) => {
        res.sendStatus(401);
      });

      const res = await request(app).get(
        "/api/meal-plan/catalog/search?query=chicken",
      );

      expect(res.status).toBe(401);
      expect(searchCatalogRecipes).not.toHaveBeenCalled();
    });

    it("returns 200 with search results", async () => {
      vi.mocked(searchCatalogRecipes).mockResolvedValue({
        results: [],
        offset: 0,
        number: 10,
        totalResults: 0,
      });

      const res = await request(app).get(
        "/api/meal-plan/catalog/search?query=chicken",
      );

      expect(res.status).toBe(200);
      expect(searchCatalogRecipes).toHaveBeenCalled();
    });

    it("returns 400 for invalid query params", async () => {
      const res = await request(app).get("/api/meal-plan/catalog/search");
      expect(res.status).toBe(400);
    });

    it("returns 403 for free tier and never calls the service", async () => {
      setUserTier("free");

      const res = await request(app).get(
        "/api/meal-plan/catalog/search?query=chicken",
      );

      expect(res.status).toBe(403);
      expect(searchCatalogRecipes).not.toHaveBeenCalled();
    });

    it("returns 500 via handleRouteError when the service throws", async () => {
      vi.mocked(searchCatalogRecipes).mockRejectedValue(new Error("boom"));

      const res = await request(app).get(
        "/api/meal-plan/catalog/search?query=chicken",
      );

      expect(res.status).toBe(500);
      expect(res.body.code).toBe("INTERNAL_ERROR");
    });
  });

  describe("GET /api/meal-plan/catalog/:id", () => {
    it("returns recipe detail", async () => {
      vi.mocked(getCatalogRecipeDetail).mockResolvedValue({
        recipe: createMockMealPlanRecipe({ title: "Chicken" }),
        ingredients: [],
      });

      const res = await request(app).get("/api/meal-plan/catalog/123");

      expect(res.status).toBe(200);
    });

    it("returns 404 when recipe is missing", async () => {
      vi.mocked(getCatalogRecipeDetail).mockResolvedValue(null);
      const res = await request(app).get("/api/meal-plan/catalog/123");
      expect(res.status).toBe(404);
    });

    it("returns 400 for invalid id", async () => {
      const res = await request(app).get("/api/meal-plan/catalog/abc");
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/meal-plan/catalog/:id/save", () => {
    it("saves catalog recipe", async () => {
      vi.mocked(storage.findMealPlanRecipeByExternalId).mockResolvedValue(
        undefined,
      );
      vi.mocked(getCatalogRecipeDetail).mockResolvedValue({
        recipe: createMockMealPlanRecipe({ title: "Chicken", mealTypes: [] }),
        ingredients: [],
      });
      vi.mocked(storage.createMealPlanRecipe).mockResolvedValue(
        createMockMealPlanRecipe({ id: 1, title: "Chicken" }),
      );

      const res = await request(app).post("/api/meal-plan/catalog/123/save");

      expect(res.status).toBe(201);
      expect(storage.createMealPlanRecipe).toHaveBeenCalled();
    });

    it("returns existing recipe when already saved", async () => {
      vi.mocked(storage.findMealPlanRecipeByExternalId).mockResolvedValue(
        createMockMealPlanRecipe({ id: 9, title: "Saved" }),
      );

      const res = await request(app).post("/api/meal-plan/catalog/123/save");

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(9);
      expect(getCatalogRecipeDetail).not.toHaveBeenCalled();
    });

    it("returns 422 when catalog recipe has no ingredients and no instructions", async () => {
      vi.mocked(storage.findMealPlanRecipeByExternalId).mockResolvedValue(
        undefined,
      );
      vi.mocked(getCatalogRecipeDetail).mockResolvedValue({
        recipe: createMockMealPlanRecipe({ instructions: [] }),
        ingredients: [],
      });

      const res = await request(app).post("/api/meal-plan/catalog/123/save");

      expect(res.status).toBe(422);
    });

    it("returns 500 via handleRouteError when save path throws", async () => {
      vi.mocked(storage.findMealPlanRecipeByExternalId).mockResolvedValue(
        undefined,
      );
      vi.mocked(getCatalogRecipeDetail).mockRejectedValue(new Error("boom"));

      const res = await request(app).post("/api/meal-plan/catalog/123/save");

      expect(res.status).toBe(500);
      expect(res.body.code).toBe("INTERNAL_ERROR");
    });
  });
});
