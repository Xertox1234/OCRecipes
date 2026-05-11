import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { requireAuth } from "../../middleware/auth";
import { importRecipeFromUrl } from "../../services/recipe-import";
import { generateRecipeImage } from "../../services/recipe-generation";
import { register } from "../recipe-import";
import {
  createMockMealPlanRecipe,
  createMockUser,
} from "../../__tests__/factories";

vi.mock("express-rate-limit");

vi.mock("../../middleware/auth");

vi.mock("../../storage", () => ({
  storage: {
    getSubscriptionStatus: vi.fn(),
    createMealPlanRecipe: vi.fn(),
    updateMealPlanRecipe: vi.fn(),
  },
}));

vi.mock("../../services/recipe-import", () => ({
  importRecipeFromUrl: vi.fn(),
}));

vi.mock("../../services/recipe-generation", () => ({
  generateRecipeImage: vi.fn(),
}));

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

const importedRecipe = {
  title: "Imported Recipe",
  description: "A recipe",
  sourceUrl: "https://example.com/recipe",
  cuisine: null,
  servings: 4,
  prepTimeMinutes: 10,
  cookTimeMinutes: 20,
  imageUrl: null,
  instructions: ["Cook it"],
  dietTags: [],
  caloriesPerServing: null,
  proteinPerServing: null,
  carbsPerServing: null,
  fatPerServing: null,
  ingredients: [{ name: "Flour", quantity: "2", unit: "cups" }],
};

describe("recipe-import routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
    setUserTier("premium");
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
        createMealPlanRecipe: vi.fn(),
        updateMealPlanRecipe: vi.fn(),
      },
    }));
    vi.doMock("../../services/recipe-import", () => ({
      importRecipeFromUrl: vi.fn(),
    }));
    vi.doMock("../../services/recipe-generation", () => ({
      generateRecipeImage: vi.fn(),
    }));

    const expressModule = await import("express");
    const supertestModule = await import("supertest");
    const routeModule = await import("../recipe-import");
    const rateLimitedApp = expressModule.default();
    rateLimitedApp.use(expressModule.default.json());
    routeModule.register(rateLimitedApp);

    const res = await supertestModule
      .default(rateLimitedApp)
      .post("/api/meal-plan/recipes/parse-url")
      .send({ url: "https://example.com/recipe" });

    expect(res.status).toBe(429);
    vi.resetModules();
  });

  describe("POST /api/meal-plan/recipes/parse-url", () => {
    it("returns 401 when auth middleware rejects", async () => {
      vi.mocked(requireAuth).mockImplementationOnce(async (_req, res) => {
        res.sendStatus(401);
      });

      const res = await request(app)
        .post("/api/meal-plan/recipes/parse-url")
        .send({ url: "https://example.com/recipe" });

      expect(res.status).toBe(401);
      expect(importRecipeFromUrl).not.toHaveBeenCalled();
    });

    it("returns normalized parsed data and does not save", async () => {
      vi.mocked(importRecipeFromUrl).mockResolvedValue({
        success: true,
        data: importedRecipe,
      });

      const res = await request(app)
        .post("/api/meal-plan/recipes/parse-url")
        .send({ url: "https://example.com/recipe" });

      expect(res.status).toBe(200);
      expect(storage.createMealPlanRecipe).not.toHaveBeenCalled();
    });

    it("returns 400 for invalid body", async () => {
      const res = await request(app)
        .post("/api/meal-plan/recipes/parse-url")
        .send({ url: "not-a-url" });

      expect(res.status).toBe(400);
    });

    it("returns 422 when importer fails", async () => {
      vi.mocked(importRecipeFromUrl).mockResolvedValue({
        success: false,
        error: "FETCH_FAILED",
      });

      const res = await request(app)
        .post("/api/meal-plan/recipes/parse-url")
        .send({ url: "https://example.com/recipe" });

      expect(res.status).toBe(422);
    });

    it("returns 500 via handleRouteError on unexpected importer error", async () => {
      vi.mocked(importRecipeFromUrl).mockRejectedValue(new Error("boom"));

      const res = await request(app)
        .post("/api/meal-plan/recipes/parse-url")
        .send({ url: "https://example.com/recipe" });

      expect(res.status).toBe(500);
      expect(res.body.code).toBe("INTERNAL_ERROR");
    });
  });

  describe("POST /api/meal-plan/recipes/import-url", () => {
    it("returns 403 for free tier and does not call importer", async () => {
      setUserTier("free");

      const res = await request(app)
        .post("/api/meal-plan/recipes/import-url")
        .send({ url: "https://example.com/recipe" });

      expect(res.status).toBe(403);
      expect(importRecipeFromUrl).not.toHaveBeenCalled();
    });

    it("returns 201 and saves imported recipe", async () => {
      vi.mocked(importRecipeFromUrl).mockResolvedValue({
        success: true,
        data: importedRecipe,
      });
      vi.mocked(storage.createMealPlanRecipe).mockResolvedValue(
        createMockMealPlanRecipe({ id: 1, title: "Imported Recipe" }),
      );

      const res = await request(app)
        .post("/api/meal-plan/recipes/import-url")
        .send({ url: "https://example.com/recipe" });

      expect(res.status).toBe(201);
      expect(storage.createMealPlanRecipe).toHaveBeenCalled();
    });

    it("returns 400 for invalid url body", async () => {
      const res = await request(app)
        .post("/api/meal-plan/recipes/import-url")
        .send({ url: "bad-url" });

      expect(res.status).toBe(400);
    });

    it("returns 422 when importer fails", async () => {
      vi.mocked(importRecipeFromUrl).mockResolvedValue({
        success: false,
        error: "NO_RECIPE_DATA",
      });

      const res = await request(app)
        .post("/api/meal-plan/recipes/import-url")
        .send({ url: "https://example.com/recipe" });

      expect(res.status).toBe(422);
    });

    it("returns before async image generation finishes", async () => {
      vi.mocked(importRecipeFromUrl).mockResolvedValue({
        success: true,
        data: importedRecipe,
      });
      vi.mocked(storage.createMealPlanRecipe).mockResolvedValue(
        createMockMealPlanRecipe({
          id: 42,
          title: "Imported Recipe",
          imageUrl: null,
        }),
      );

      let resolveImage!: (value: string | null) => void;
      const imagePromise = new Promise<string | null>((resolve) => {
        resolveImage = resolve;
      });
      vi.mocked(generateRecipeImage).mockReturnValue(
        imagePromise as ReturnType<typeof generateRecipeImage>,
      );

      const res = await request(app)
        .post("/api/meal-plan/recipes/import-url")
        .send({ url: "https://example.com/recipe" });

      expect(res.status).toBe(201);
      expect(storage.updateMealPlanRecipe).not.toHaveBeenCalled();

      resolveImage("https://example.com/generated.png");
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(storage.updateMealPlanRecipe).toHaveBeenCalledWith(42, "1", {
        imageUrl: "https://example.com/generated.png",
      });
    });

    it("returns 500 via handleRouteError when persistence throws", async () => {
      vi.mocked(importRecipeFromUrl).mockResolvedValue({
        success: true,
        data: importedRecipe,
      });
      vi.mocked(storage.createMealPlanRecipe).mockRejectedValue(
        new Error("db"),
      );

      const res = await request(app)
        .post("/api/meal-plan/recipes/import-url")
        .send({ url: "https://example.com/recipe" });

      expect(res.status).toBe(500);
      expect(res.body.code).toBe("INTERNAL_ERROR");
    });
  });
});
