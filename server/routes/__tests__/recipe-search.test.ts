/**
 * HTTP-level tests for recipe-search routes.
 *
 * Covers the route boundary (auth, Zod validation, rate-limit middleware
 * wiring, handleRouteError) for the two handlers registered in
 * `server/routes/recipe-search.ts`:
 *   - GET /api/recipes/search
 *   - GET /api/recipes/browse
 *
 * The MiniSearch service is mocked — the source-aware `numericPassThrough`
 * filter behavior (audit 2026-04-18 H10) is tested in
 * `server/services/__tests__/recipe-search.test.ts`. At the HTTP level this
 * file asserts:
 *   - empty-string numeric filters are rejected by Zod (cannot reach the
 *     service with a meaningless value)
 *   - valid numeric filters are coerced and forwarded to the service
 *
 * Originating from audit 2026-05-11 M4 (testing). Neither handler is gated
 * by premium — `requireAuth + instructionsRateLimit` only.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { register } from "../recipe-search";
import { searchRecipes } from "../../services/recipe-search";
import { storage } from "../../storage";
import { createMockMealPlanRecipe } from "../../__tests__/factories";

vi.mock("../../services/recipe-search", () => ({
  searchRecipes: vi.fn().mockResolvedValue({
    results: [],
    total: 0,
    offset: 0,
    limit: 20,
    query: { q: null, filters: {}, sort: "relevance" },
  }),
  initSearchIndex: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../middleware/auth");

vi.mock("express-rate-limit");

vi.mock("../../storage", () => ({
  storage: {
    getUnifiedRecipes: vi.fn(),
    getFrequentRecipesForMealType: vi.fn(),
  },
}));

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

describe("GET /api/recipes/search", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(searchRecipes).mockResolvedValue({
      results: [],
      total: 0,
      offset: 0,
      limit: 20,
      query: { q: null, filters: {}, sort: "relevance" },
    });
    app = createApp();
  });

  it("returns 400 for invalid sort value", async () => {
    const res = await request(app)
      .get("/api/recipes/search?sort=invalid")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when q exceeds 200 chars", async () => {
    const longQ = "a".repeat(201);
    const res = await request(app)
      .get(`/api/recipes/search?q=${longQ}`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(400);
  });

  it("returns 400 when limit exceeds 50 (max)", async () => {
    const res = await request(app)
      .get("/api/recipes/search?limit=100")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(400);
  });

  it("returns 200 with empty search results on happy path", async () => {
    const res = await request(app)
      .get("/api/recipes/search?q=chicken")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      results: expect.any(Array),
      total: 0,
    });
  });

  it("forwards coerced numeric filters to the service", async () => {
    await request(app)
      .get(
        "/api/recipes/search?q=pasta&maxCalories=400&minProtein=20&maxPrepTime=30",
      )
      .set("Authorization", "Bearer token");

    expect(searchRecipes).toHaveBeenCalledWith(
      expect.objectContaining({
        q: "pasta",
        maxCalories: 400,
        minProtein: 20,
        maxPrepTime: 30,
      }),
      expect.any(String),
    );
  });

  describe("numericPassThrough filter input handling (audit 2026-04-18 H10)", () => {
    // The service-level "null-nutrition pass-through" assertion lives in
    // recipe-search service tests. At the route boundary we verify that
    // empty-string and zero values are filtered out at Zod (cannot reach
    // the service with a meaningless value), while valid integers are
    // coerced and forwarded.

    it("returns 400 when maxCalories is an empty string (coerces to 0, fails min(1))", async () => {
      const res = await request(app)
        .get("/api/recipes/search?q=pasta&maxCalories=")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
      expect(searchRecipes).not.toHaveBeenCalled();
    });

    it("returns 400 when minProtein is non-numeric", async () => {
      const res = await request(app)
        .get("/api/recipes/search?q=pasta&minProtein=abc")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
      expect(searchRecipes).not.toHaveBeenCalled();
    });

    it("returns 400 when maxCalories exceeds the 5000 ceiling", async () => {
      const res = await request(app)
        .get("/api/recipes/search?q=pasta&maxCalories=99999")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
    });

    it("omits the filter from forwarded params when the query param is absent", async () => {
      await request(app)
        .get("/api/recipes/search?q=pasta")
        .set("Authorization", "Bearer token");

      const callArgs = vi.mocked(searchRecipes).mock.calls[0]?.[0];
      expect(callArgs?.maxCalories).toBeUndefined();
      expect(callArgs?.minProtein).toBeUndefined();
      expect(callArgs?.maxPrepTime).toBeUndefined();
    });
  });

  it("returns 500 on service error (handleRouteError fallback)", async () => {
    vi.mocked(searchRecipes).mockRejectedValue(new Error("index error"));

    const res = await request(app)
      .get("/api/recipes/search?q=chicken")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(500);
  });
});

describe("GET /api/recipes/browse", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storage.getUnifiedRecipes).mockResolvedValue({
      community: [],
      personal: [],
    });
    vi.mocked(storage.getFrequentRecipesForMealType).mockResolvedValue([]);
    app = createApp();
  });

  it("returns 400 for invalid mealType", async () => {
    const res = await request(app)
      .get("/api/recipes/browse?mealType=brunch")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when limit exceeds 100 (max)", async () => {
    const res = await request(app)
      .get("/api/recipes/browse?limit=200")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(400);
  });

  it("scopes getUnifiedRecipes to the authenticated userId (IDOR guard)", async () => {
    await request(app)
      .get("/api/recipes/browse")
      .set("Authorization", "Bearer token");

    // Auth mock sets req.userId = "1" — lock the assertion to that value.
    expect(storage.getUnifiedRecipes).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "1" }),
    );
  });

  it("returns 200 with community/personal/frequent shape on happy path", async () => {
    const recipe = createMockMealPlanRecipe({
      id: 1,
      title: "Pasta",
      userId: "author-1",
    });
    vi.mocked(storage.getUnifiedRecipes).mockResolvedValue({
      community: [
        { ...recipe, authorId: "author-1" } as unknown as Awaited<
          ReturnType<typeof storage.getUnifiedRecipes>
        >["community"][number],
      ],
      personal: [recipe],
    });

    const res = await request(app)
      .get("/api/recipes/browse")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("community");
    expect(res.body).toHaveProperty("personal");
    expect(res.body).toHaveProperty("frequent");
    // authorId must be stripped from community recipes (public-facing).
    expect(res.body.community[0]).not.toHaveProperty("authorId");
  });

  it("only fetches frequent recipes when mealType is provided", async () => {
    await request(app)
      .get("/api/recipes/browse")
      .set("Authorization", "Bearer token");
    expect(storage.getFrequentRecipesForMealType).not.toHaveBeenCalled();

    vi.mocked(storage.getFrequentRecipesForMealType).mockClear();

    await request(app)
      .get("/api/recipes/browse?mealType=breakfast")
      .set("Authorization", "Bearer token");
    expect(storage.getFrequentRecipesForMealType).toHaveBeenCalledWith(
      "1",
      "breakfast",
    );
  });

  it("returns 500 on storage error", async () => {
    vi.mocked(storage.getUnifiedRecipes).mockRejectedValue(new Error("DB"));

    const res = await request(app)
      .get("/api/recipes/browse?query=pasta")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(500);
  });
});

describe("recipe-search auth & rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("GET /api/recipes/search returns 401 without a bearer token", async () => {
    vi.doUnmock("../../middleware/auth");
    try {
      const { register: registerReal } = await import("../recipe-search");
      const app = express();
      app.use(express.json());
      registerReal(app);

      const res = await request(app).get("/api/recipes/search?q=chicken");
      expect(res.status).toBe(401);
    } finally {
      vi.doMock("../../middleware/auth", async () => {
        const actual = await vi.importActual<
          typeof import("../../middleware/__mocks__/auth")
        >("../../middleware/__mocks__/auth");
        return actual;
      });
    }
  });

  it("returns 429 after instructionsRateLimit (20/min) is exceeded", async () => {
    vi.doUnmock("express-rate-limit");

    vi.doMock("../../services/recipe-search", () => ({
      searchRecipes: vi.fn().mockResolvedValue({
        results: [],
        total: 0,
        offset: 0,
        limit: 20,
        query: { q: null, filters: {}, sort: "relevance" },
      }),
      initSearchIndex: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock("../../storage", () => ({
      storage: {
        getUnifiedRecipes: vi
          .fn()
          .mockResolvedValue({ community: [], personal: [] }),
        getFrequentRecipesForMealType: vi.fn().mockResolvedValue([]),
      },
    }));

    const { register: registerReal } = await import("../recipe-search");
    const app = express();
    app.use(express.json());
    registerReal(app);

    // instructionsRateLimit is 20/min — fire 21 to trigger 429 on the last one.
    let lastStatus = 0;
    for (let i = 0; i < 21; i++) {
      const res = await request(app)
        .get("/api/recipes/search?q=chicken")
        .set("Authorization", "Bearer token");
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});
