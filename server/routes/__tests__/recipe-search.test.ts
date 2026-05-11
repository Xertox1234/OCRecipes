import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { requireAuth } from "../../middleware/auth";
import { searchRecipes } from "../../services/recipe-search";
import { register } from "../recipe-search";
import {
  createMockCommunityRecipe,
  createMockMealPlanRecipe,
} from "../../__tests__/factories";

vi.mock("express-rate-limit");

vi.mock("../../middleware/auth");

vi.mock("../../storage", () => ({
  storage: {
    getUnifiedRecipes: vi.fn(),
    getFrequentRecipesForMealType: vi.fn(),
  },
}));

vi.mock("../../services/recipe-search", () => ({
  searchRecipes: vi.fn().mockResolvedValue({
    results: [],
    total: 0,
    offset: 0,
    limit: 20,
    query: { q: null, filters: {}, sort: "relevance" },
  }),
}));

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

describe("recipe-search routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
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
        getUnifiedRecipes: vi.fn(),
        getFrequentRecipesForMealType: vi.fn(),
      },
    }));
    vi.doMock("../../services/recipe-search", () => ({
      searchRecipes: vi.fn(),
    }));

    const expressModule = await import("express");
    const supertestModule = await import("supertest");
    const routeModule = await import("../recipe-search");
    const rateLimitedApp = expressModule.default();
    rateLimitedApp.use(expressModule.default.json());
    routeModule.register(rateLimitedApp);

    const res = await supertestModule
      .default(rateLimitedApp)
      .get("/api/recipes/search?q=chicken");

    expect(res.status).toBe(429);
    vi.resetModules();
  });

  describe("GET /api/recipes/search", () => {
    it("returns 401 when auth middleware rejects", async () => {
      vi.mocked(requireAuth).mockImplementationOnce(async (_req, res) => {
        res.sendStatus(401);
      });

      const res = await request(app).get("/api/recipes/search?q=chicken");

      expect(res.status).toBe(401);
      expect(searchRecipes).not.toHaveBeenCalled();
    });

    it("returns search results", async () => {
      vi.mocked(searchRecipes).mockResolvedValue({
        results: [{ id: "personal:1", title: "Chicken" }],
        total: 1,
        offset: 0,
        limit: 20,
        query: { q: "chicken", filters: {}, sort: "relevance" },
      } as Awaited<ReturnType<typeof searchRecipes>>);

      const res = await request(app).get("/api/recipes/search?q=chicken");

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(searchRecipes).toHaveBeenCalledWith(
        expect.objectContaining({ q: "chicken" }),
        "1",
      );
    });

    it("returns 400 for invalid query params", async () => {
      const res = await request(app).get("/api/recipes/search?sort=invalid");
      expect(res.status).toBe(400);
    });

    it("parses empty minProtein query as numeric zero", async () => {
      const res = await request(app).get("/api/recipes/search?minProtein=");

      expect(res.status).toBe(200);
      expect(searchRecipes).toHaveBeenCalledWith(
        expect.objectContaining({ minProtein: 0 }),
        "1",
      );
    });

    it("returns 500 via handleRouteError when search service throws", async () => {
      vi.mocked(searchRecipes).mockRejectedValue(new Error("boom"));

      const res = await request(app).get("/api/recipes/search?q=chicken");

      expect(res.status).toBe(500);
      expect(res.body.code).toBe("INTERNAL_ERROR");
    });
  });

  describe("GET /api/recipes/browse", () => {
    it("returns unified browse response and strips community authorId", async () => {
      vi.mocked(storage.getUnifiedRecipes).mockResolvedValue({
        community: [createMockCommunityRecipe({ id: 1, authorId: "1" })],
        personal: [createMockMealPlanRecipe({ id: 2, userId: "1" })],
      });
      vi.mocked(storage.getFrequentRecipesForMealType).mockResolvedValue([
        createMockMealPlanRecipe({ id: 3, title: "Oatmeal" }),
      ]);

      const res = await request(app).get(
        "/api/recipes/browse?mealType=breakfast",
      );

      expect(res.status).toBe(200);
      expect(res.body.community[0].authorId).toBeUndefined();
      expect(res.body.frequent).toHaveLength(1);
    });

    it("returns 400 for invalid browse params", async () => {
      const res = await request(app).get("/api/recipes/browse?mealType=brunch");
      expect(res.status).toBe(400);
    });

    it("returns 500 via handleRouteError when browse storage throws", async () => {
      vi.mocked(storage.getUnifiedRecipes).mockRejectedValue(new Error("db"));

      const res = await request(app).get("/api/recipes/browse");

      expect(res.status).toBe(500);
      expect(res.body.code).toBe("INTERNAL_ERROR");
    });
  });
});
