/**
 * HTTP-level tests for recipe-catalog routes.
 *
 * Covers the route boundary (auth, Zod validation, premium gate, rate-limit
 * middleware wiring, handleRouteError) for the three handlers registered in
 * `server/routes/recipe-catalog.ts`:
 *   - GET  /api/meal-plan/catalog/search
 *   - GET  /api/meal-plan/catalog/:id
 *   - POST /api/meal-plan/catalog/:id/save
 *
 * The service layer (Spoonacular client, caching) is mocked — service-level
 * behavior is covered by `server/services/__tests__/recipe-catalog.test.ts`.
 *
 * Originating from audit 2026-05-11 M4 (testing). Premium gates on /search
 * and /:id were added by audit 2026-04-18 H7 — these tests guard against a
 * future refactor silently disabling them.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { register } from "../recipe-catalog";
import {
  searchCatalogRecipes,
  getCatalogRecipeDetail,
  CatalogQuotaError,
} from "../../services/recipe-catalog";
import { storage } from "../../storage";
import { createMockMealPlanRecipe } from "../../__tests__/factories";

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

vi.mock("express-rate-limit");

vi.mock("../../storage", () => ({
  storage: {
    getSubscriptionStatus: vi.fn(),
    getUserProfile: vi.fn(),
    findMealPlanRecipeByExternalId: vi.fn(),
    createMealPlanRecipe: vi.fn(),
  },
}));

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

describe("recipe-catalog routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: premium user (most handlers require it).
    vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
      tier: "premium",
      expiresAt: null,
    });
    vi.mocked(storage.getUserProfile).mockResolvedValue(undefined);
    app = createApp();
  });

  describe("GET /api/meal-plan/catalog/search", () => {
    it("returns 400 when query parameter is missing", async () => {
      const res = await request(app)
        .get("/api/meal-plan/catalog/search")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 with Zod error message for invalid maxReadyTime", async () => {
      const res = await request(app)
        .get("/api/meal-plan/catalog/search?query=chicken&maxReadyTime=abc")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });

    it("returns 403 when subscriptionTier is free (H7 — 2026-04-18)", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "free",
        expiresAt: null,
      });

      const res = await request(app)
        .get("/api/meal-plan/catalog/search?query=chicken")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("PREMIUM_REQUIRED");
      // Service must not be called — gate runs before Spoonacular quota burn.
      expect(searchCatalogRecipes).not.toHaveBeenCalled();
    });

    it("returns 200 with search results on happy path", async () => {
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
      expect(res.body).toMatchObject({
        results: expect.any(Array),
        totalResults: 0,
      });
    });

    it("forwards user allergies as Spoonacular intolerances", async () => {
      vi.mocked(storage.getUserProfile).mockResolvedValue({
        allergies: [
          { name: "peanuts", severity: "severe" },
          { name: "milk", severity: "mild" },
        ],
      } as unknown as Awaited<ReturnType<typeof storage.getUserProfile>>);
      vi.mocked(searchCatalogRecipes).mockResolvedValue({
        results: [],
        offset: 0,
        number: 10,
        totalResults: 0,
      });

      await request(app)
        .get("/api/meal-plan/catalog/search?query=stew")
        .set("Authorization", "Bearer token");

      expect(searchCatalogRecipes).toHaveBeenCalledWith(
        expect.objectContaining({ intolerances: "peanut,dairy" }),
      );
    });

    it("returns 402 with CATALOG_QUOTA_EXCEEDED when Spoonacular quota is exhausted", async () => {
      vi.mocked(searchCatalogRecipes).mockRejectedValue(
        new CatalogQuotaError("Spoonacular API quota exceeded"),
      );

      const res = await request(app)
        .get("/api/meal-plan/catalog/search?query=chicken")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(402);
      expect(res.body.code).toBe("CATALOG_QUOTA_EXCEEDED");
    });

    it("returns 500 with handleRouteError fallback on unexpected service error", async () => {
      vi.mocked(searchCatalogRecipes).mockRejectedValue(new Error("boom"));

      const res = await request(app)
        .get("/api/meal-plan/catalog/search?query=chicken")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
    });
  });

  describe("GET /api/meal-plan/catalog/:id", () => {
    it("returns 400 for non-numeric id", async () => {
      const res = await request(app)
        .get("/api/meal-plan/catalog/abc")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 for zero / negative id (parsePositiveIntParam guard)", async () => {
      const res = await request(app)
        .get("/api/meal-plan/catalog/0")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
    });

    it("returns 403 when subscriptionTier is free (H7 — 2026-04-18)", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "free",
        expiresAt: null,
      });

      const res = await request(app)
        .get("/api/meal-plan/catalog/123")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(403);
      expect(getCatalogRecipeDetail).not.toHaveBeenCalled();
    });

    it("returns 404 when service returns null", async () => {
      vi.mocked(getCatalogRecipeDetail).mockResolvedValue(null);

      const res = await request(app)
        .get("/api/meal-plan/catalog/123")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
    });

    it("returns 200 with recipe detail on happy path", async () => {
      vi.mocked(getCatalogRecipeDetail).mockResolvedValue({
        recipe: createMockMealPlanRecipe({ title: "Chicken Soup" }),
        ingredients: [],
      });

      const res = await request(app)
        .get("/api/meal-plan/catalog/123")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.recipe.title).toBe("Chicken Soup");
    });

    it("returns 402 when Spoonacular quota is exhausted", async () => {
      vi.mocked(getCatalogRecipeDetail).mockRejectedValue(
        new CatalogQuotaError("Spoonacular API quota exceeded"),
      );

      const res = await request(app)
        .get("/api/meal-plan/catalog/123")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(402);
      expect(res.body.code).toBe("CATALOG_QUOTA_EXCEEDED");
    });
  });

  describe("POST /api/meal-plan/catalog/:id/save", () => {
    it("returns 400 for non-numeric id", async () => {
      const res = await request(app)
        .post("/api/meal-plan/catalog/abc/save")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
    });

    it("returns 403 for free tier before Spoonacular is called", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "free",
        expiresAt: null,
      });

      const res = await request(app)
        .post("/api/meal-plan/catalog/123/save")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(403);
      expect(getCatalogRecipeDetail).not.toHaveBeenCalled();
    });

    it("returns existing recipe (200) when already saved (idempotent dedup)", async () => {
      const existing = createMockMealPlanRecipe({ id: 42, title: "Saved" });
      vi.mocked(storage.findMealPlanRecipeByExternalId).mockResolvedValue(
        existing,
      );

      const res = await request(app)
        .post("/api/meal-plan/catalog/123/save")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(42);
      // IDOR guard: dedup lookup must be scoped to the auth-mock userId "1".
      expect(storage.findMealPlanRecipeByExternalId).toHaveBeenCalledWith(
        "1",
        "123",
      );
      // Must not hit Spoonacular when dedup short-circuits.
      expect(getCatalogRecipeDetail).not.toHaveBeenCalled();
    });

    it("returns 201 with newly saved recipe on happy path", async () => {
      vi.mocked(storage.findMealPlanRecipeByExternalId).mockResolvedValue(
        undefined,
      );
      vi.mocked(getCatalogRecipeDetail).mockResolvedValue({
        recipe: createMockMealPlanRecipe({ title: "Pasta" }),
        ingredients: [],
      });
      vi.mocked(storage.createMealPlanRecipe).mockResolvedValue(
        createMockMealPlanRecipe({ id: 7, title: "Pasta" }),
      );

      const res = await request(app)
        .post("/api/meal-plan/catalog/123/save")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(201);
      expect(res.body.id).toBe(7);
      // IDOR guard: dedup lookup AND the create call must both scope to the
      // auth-mock userId "1" — not any string the handler happens to forward.
      expect(storage.findMealPlanRecipeByExternalId).toHaveBeenCalledWith(
        "1",
        "123",
      );
      expect(storage.createMealPlanRecipe).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "1" }),
        expect.any(Array),
      );
    });

    it("returns 422 when catalog recipe has no instructions and no ingredients", async () => {
      vi.mocked(storage.findMealPlanRecipeByExternalId).mockResolvedValue(
        undefined,
      );
      vi.mocked(getCatalogRecipeDetail).mockResolvedValue({
        recipe: createMockMealPlanRecipe({ title: "Empty", instructions: [] }),
        ingredients: [],
      });

      const res = await request(app)
        .post("/api/meal-plan/catalog/123/save")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(422);
      expect(res.body.error).toMatch(/no instructions or ingredients/);
    });

    it("returns 404 when Spoonacular has no such recipe", async () => {
      vi.mocked(storage.findMealPlanRecipeByExternalId).mockResolvedValue(
        undefined,
      );
      vi.mocked(getCatalogRecipeDetail).mockResolvedValue(null);

      const res = await request(app)
        .post("/api/meal-plan/catalog/999/save")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(404);
    });

    it("recovers from TOCTOU duplicate (Postgres 23505) by returning existing recipe", async () => {
      vi.mocked(storage.findMealPlanRecipeByExternalId)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(
          createMockMealPlanRecipe({ id: 99, title: "Existing" }),
        );
      vi.mocked(getCatalogRecipeDetail).mockResolvedValue({
        recipe: createMockMealPlanRecipe({ title: "Existing" }),
        ingredients: [],
      });
      const dupError = Object.assign(new Error("duplicate"), { code: "23505" });
      vi.mocked(storage.createMealPlanRecipe).mockRejectedValue(dupError);

      const res = await request(app)
        .post("/api/meal-plan/catalog/123/save")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(99);
    });

    it("recovers from a wrapped DrizzleQueryError (cause.code 23505) by returning existing recipe", async () => {
      vi.mocked(storage.findMealPlanRecipeByExternalId)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(
          createMockMealPlanRecipe({ id: 99, title: "Existing" }),
        );
      vi.mocked(getCatalogRecipeDetail).mockResolvedValue({
        recipe: createMockMealPlanRecipe({ title: "Existing" }),
        ingredients: [],
      });
      // drizzle-orm 0.44+ wraps the pg error: the 23505 code moves to .cause.
      const wrapped = Object.assign(new Error("Failed query: insert ..."), {
        cause: { code: "23505" },
      });
      vi.mocked(storage.createMealPlanRecipe).mockRejectedValue(wrapped);

      const res = await request(app)
        .post("/api/meal-plan/catalog/123/save")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(99);
    });
  });
});

describe("recipe-catalog auth & rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("GET /api/meal-plan/catalog/search returns 401 without a bearer token", async () => {
    vi.doUnmock("../../middleware/auth");
    try {
      const { register: registerReal } = await import("../recipe-catalog");
      const app = express();
      app.use(express.json());
      registerReal(app);

      const res = await request(app).get(
        "/api/meal-plan/catalog/search?query=chicken",
      );
      expect(res.status).toBe(401);
    } finally {
      // Restore the auth mock even if the assertion failed — otherwise the
      // unmock leaks to later dynamic imports in this file.
      vi.doMock("../../middleware/auth", async () => {
        const actual = await vi.importActual<
          typeof import("../../middleware/__mocks__/auth")
        >("../../middleware/__mocks__/auth");
        return actual;
      });
    }
  });

  it("returns 429 after mealPlanRateLimit (30/min) is exceeded", async () => {
    // Use the real express-rate-limit so the limiter actually counts requests.
    vi.doUnmock("express-rate-limit");

    vi.doMock("../../storage", () => ({
      storage: {
        getSubscriptionStatus: vi
          .fn()
          .mockResolvedValue({ tier: "premium", expiresAt: null }),
        getUserProfile: vi.fn().mockResolvedValue(undefined),
      },
    }));
    vi.doMock("../../services/recipe-catalog", async () => {
      const actual = await vi.importActual<
        typeof import("../../services/recipe-catalog")
      >("../../services/recipe-catalog");
      return {
        ...actual,
        searchCatalogRecipes: vi.fn().mockResolvedValue({
          results: [],
          offset: 0,
          number: 10,
          totalResults: 0,
        }),
        getCatalogRecipeDetail: vi.fn(),
      };
    });

    const { register: registerReal } = await import("../recipe-catalog");
    const app = express();
    app.use(express.json());
    registerReal(app);

    // mealPlanRateLimit is 30/min — fire 31 to trigger 429 on the last one.
    let lastStatus = 0;
    for (let i = 0; i < 31; i++) {
      const res = await request(app)
        .get("/api/meal-plan/catalog/search?query=chicken")
        .set("Authorization", "Bearer token");
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});
