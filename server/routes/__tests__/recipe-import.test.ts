/**
 * HTTP-level tests for recipe-import routes.
 *
 * Covers the route boundary (auth, Zod validation, premium gate, rate-limit
 * middleware wiring, handleRouteError) for the two handlers registered in
 * `server/routes/recipe-import.ts`:
 *   - POST /api/meal-plan/recipes/parse-url   (free preview)
 *   - POST /api/meal-plan/recipes/import-url  (premium, saves + async image gen)
 *
 * The service layer (URL fetch, JSON-LD parse, image generation) is mocked —
 * service-level behavior is covered by `server/services/__tests__/recipe-import.test.ts`.
 *
 * Originating from audit 2026-05-11 M4 (testing). The async image-generation
 * ordering test guards the fire-and-forget contract: response must return
 * BEFORE `generateRecipeImage` resolves and `updateMealPlanRecipe` fires.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { register } from "../recipe-import";
import { importRecipeFromUrl } from "../../services/recipe-import";
import { generateRecipeImage } from "../../services/recipe-generation";
import { storage } from "../../storage";
import { createMockMealPlanRecipe } from "../../__tests__/factories";

vi.mock("../../services/recipe-import", () => ({
  importRecipeFromUrl: vi.fn(),
}));

vi.mock("../../services/recipe-generation", () => ({
  generateRecipeImage: vi.fn(),
}));

vi.mock("../../middleware/auth");

vi.mock("express-rate-limit");

vi.mock("../../storage", () => ({
  storage: {
    getSubscriptionStatus: vi.fn(),
    createMealPlanRecipe: vi.fn(),
    updateMealPlanRecipe: vi.fn(),
  },
}));

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

function buildImportedData(
  overrides: Partial<{
    instructions: string[] | null;
    ingredients: {
      name: string;
      quantity: string | null;
      unit: string | null;
    }[];
    imageUrl: string | null;
    title: string;
  }> = {},
) {
  return {
    title: overrides.title ?? "Imported Recipe",
    description: "A recipe",
    sourceUrl: "https://example.com/recipe",
    cuisine: null,
    servings: 4,
    prepTimeMinutes: 10,
    cookTimeMinutes: 20,
    imageUrl: overrides.imageUrl ?? null,
    instructions: overrides.instructions ?? ["Cook it"],
    dietTags: [],
    caloriesPerServing: null,
    proteinPerServing: null,
    carbsPerServing: null,
    fatPerServing: null,
    ingredients: overrides.ingredients ?? [
      { name: "Flour", quantity: "2", unit: "cups" },
    ],
  };
}

describe("POST /api/meal-plan/recipes/parse-url (free preview)", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
      tier: "free",
      expiresAt: null,
    });
    app = createApp();
  });

  it("returns 400 when url field is missing", async () => {
    const res = await request(app)
      .post("/api/meal-plan/recipes/parse-url")
      .set("Authorization", "Bearer token")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for invalid URL string", async () => {
    const res = await request(app)
      .post("/api/meal-plan/recipes/parse-url")
      .set("Authorization", "Bearer token")
      .send({ url: "not-a-url" });

    expect(res.status).toBe(400);
  });

  it("returns 400 for non-HTTP scheme (refine rejects ftp://)", async () => {
    const res = await request(app)
      .post("/api/meal-plan/recipes/parse-url")
      .set("Authorization", "Bearer token")
      .send({ url: "ftp://example.com/recipe" });

    expect(res.status).toBe(400);
  });

  it("does NOT require premium (free preview endpoint)", async () => {
    vi.mocked(importRecipeFromUrl).mockResolvedValue({
      success: true,
      data: buildImportedData(),
    });

    const res = await request(app)
      .post("/api/meal-plan/recipes/parse-url")
      .set("Authorization", "Bearer token")
      .send({ url: "https://example.com/recipe" });

    expect(res.status).toBe(200);
  });

  it("returns 200 with parsed data — must NOT persist to DB", async () => {
    vi.mocked(importRecipeFromUrl).mockResolvedValue({
      success: true,
      data: buildImportedData({ title: "Parsed Preview" }),
    });

    const res = await request(app)
      .post("/api/meal-plan/recipes/parse-url")
      .set("Authorization", "Bearer token")
      .send({ url: "https://example.com/recipe" });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Parsed Preview");
    expect(storage.createMealPlanRecipe).not.toHaveBeenCalled();
  });

  it("returns 422 when fetch fails (FETCH_FAILED)", async () => {
    vi.mocked(importRecipeFromUrl).mockResolvedValue({
      success: false,
      error: "FETCH_FAILED",
    });

    const res = await request(app)
      .post("/api/meal-plan/recipes/parse-url")
      .set("Authorization", "Bearer token")
      .send({ url: "https://example.com/bad" });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("FETCH_FAILED");
  });

  it("returns 422 when parsed recipe has no instructions and no ingredients", async () => {
    vi.mocked(importRecipeFromUrl).mockResolvedValue({
      success: true,
      data: buildImportedData({ instructions: [], ingredients: [] }),
    });

    const res = await request(app)
      .post("/api/meal-plan/recipes/parse-url")
      .set("Authorization", "Bearer token")
      .send({ url: "https://example.com/empty" });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/no instructions or ingredients/);
  });

  it("returns 500 on unexpected service error", async () => {
    vi.mocked(importRecipeFromUrl).mockRejectedValue(new Error("boom"));

    const res = await request(app)
      .post("/api/meal-plan/recipes/parse-url")
      .set("Authorization", "Bearer token")
      .send({ url: "https://example.com/recipe" });

    expect(res.status).toBe(500);
  });
});

describe("POST /api/meal-plan/recipes/import-url (premium)", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
      tier: "premium",
      expiresAt: null,
    });
    app = createApp();
  });

  it("returns 403 for free tier — must NOT call the importer", async () => {
    vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
      tier: "free",
      expiresAt: null,
    });

    const res = await request(app)
      .post("/api/meal-plan/recipes/import-url")
      .set("Authorization", "Bearer token")
      .send({ url: "https://example.com/recipe" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PREMIUM_REQUIRED");
    expect(importRecipeFromUrl).not.toHaveBeenCalled();
  });

  it("returns 400 when url is missing", async () => {
    const res = await request(app)
      .post("/api/meal-plan/recipes/import-url")
      .set("Authorization", "Bearer token")
      .send({});

    expect(res.status).toBe(400);
  });

  it("returns 422 when fetch fails", async () => {
    vi.mocked(importRecipeFromUrl).mockResolvedValue({
      success: false,
      error: "FETCH_FAILED",
    });

    const res = await request(app)
      .post("/api/meal-plan/recipes/import-url")
      .set("Authorization", "Bearer token")
      .send({ url: "https://example.com/bad" });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("FETCH_FAILED");
  });

  it("returns 422 when imported recipe has no instructions and no ingredients", async () => {
    vi.mocked(importRecipeFromUrl).mockResolvedValue({
      success: true,
      data: buildImportedData({ instructions: [], ingredients: [] }),
    });

    const res = await request(app)
      .post("/api/meal-plan/recipes/import-url")
      .set("Authorization", "Bearer token")
      .send({ url: "https://example.com/empty" });

    expect(res.status).toBe(422);
  });

  it("returns 201 with saved recipe on happy path", async () => {
    vi.mocked(importRecipeFromUrl).mockResolvedValue({
      success: true,
      data: buildImportedData({
        title: "Imported",
        imageUrl: "https://example.com/img.jpg",
      }),
    });
    vi.mocked(storage.createMealPlanRecipe).mockResolvedValue(
      createMockMealPlanRecipe({
        id: 1,
        title: "Imported",
        imageUrl: "https://example.com/img.jpg",
      }),
    );

    const res = await request(app)
      .post("/api/meal-plan/recipes/import-url")
      .set("Authorization", "Bearer token")
      .send({ url: "https://example.com/recipe" });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(1);
    // IDOR guard: the persisted recipe must be owned by the auth-mock userId "1".
    expect(storage.createMealPlanRecipe).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "1" }),
      expect.any(Array),
    );
    // Source already had an image — no async generation should fire.
    expect(generateRecipeImage).not.toHaveBeenCalled();
  });

  it("returns 500 on unexpected importer error", async () => {
    vi.mocked(importRecipeFromUrl).mockRejectedValue(new Error("boom"));

    const res = await request(app)
      .post("/api/meal-plan/recipes/import-url")
      .set("Authorization", "Bearer token")
      .send({ url: "https://example.com/recipe" });

    expect(res.status).toBe(500);
  });

  describe("async image generation (fire-and-forget)", () => {
    it("returns 201 BEFORE generateRecipeImage resolves", async () => {
      vi.mocked(importRecipeFromUrl).mockResolvedValue({
        success: true,
        data: buildImportedData({ imageUrl: null }),
      });
      vi.mocked(storage.createMealPlanRecipe).mockResolvedValue(
        createMockMealPlanRecipe({ id: 5, title: "No Image", imageUrl: null }),
      );

      // Deferred image-gen promise so we can observe ordering.
      let resolveImg!: (v: string | null) => void;
      vi.mocked(generateRecipeImage).mockReturnValue(
        new Promise<string | null>((r) => {
          resolveImg = r;
        }),
      );

      const res = await request(app)
        .post("/api/meal-plan/recipes/import-url")
        .set("Authorization", "Bearer token")
        .send({ url: "https://example.com/recipe" });

      // Response has returned, but image generation is still pending.
      expect(res.status).toBe(201);
      expect(generateRecipeImage).toHaveBeenCalledTimes(1);
      expect(storage.updateMealPlanRecipe).not.toHaveBeenCalled();

      // Unblock cleanup. Wait one microtask flush for the patch to fire.
      resolveImg("https://gen.example.com/img.jpg");
      await new Promise((r) => setImmediate(r));
      // The background patch must be scoped to the auth-mock userId "1".
      expect(storage.updateMealPlanRecipe).toHaveBeenCalledWith(5, "1", {
        imageUrl: "https://gen.example.com/img.jpg",
      });
    });

    it("does not patch the recipe when generation returns null", async () => {
      vi.mocked(importRecipeFromUrl).mockResolvedValue({
        success: true,
        data: buildImportedData({ imageUrl: null }),
      });
      vi.mocked(storage.createMealPlanRecipe).mockResolvedValue(
        createMockMealPlanRecipe({ id: 6, title: "No Image", imageUrl: null }),
      );
      vi.mocked(generateRecipeImage).mockResolvedValue(null);

      const res = await request(app)
        .post("/api/meal-plan/recipes/import-url")
        .set("Authorization", "Bearer token")
        .send({ url: "https://example.com/recipe" });

      expect(res.status).toBe(201);
      // Let the fire-and-forget chain settle.
      await new Promise((r) => setImmediate(r));
      expect(storage.updateMealPlanRecipe).not.toHaveBeenCalled();
    });
  });
});

describe("recipe-import auth & rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("POST /api/meal-plan/recipes/parse-url returns 401 without a bearer token", async () => {
    vi.doUnmock("../../middleware/auth");
    try {
      const { register: registerReal } = await import("../recipe-import");
      const app = express();
      app.use(express.json());
      registerReal(app);

      const res = await request(app)
        .post("/api/meal-plan/recipes/parse-url")
        .send({ url: "https://example.com/recipe" });
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

  it("returns 429 after urlImportRateLimit (5/min) is exceeded", async () => {
    vi.doUnmock("express-rate-limit");

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
      importRecipeFromUrl: vi.fn().mockResolvedValue({
        success: false,
        error: "FETCH_FAILED",
      }),
    }));
    vi.doMock("../../services/recipe-generation", () => ({
      generateRecipeImage: vi.fn().mockResolvedValue(null),
    }));

    const { register: registerReal } = await import("../recipe-import");
    const app = express();
    app.use(express.json());
    registerReal(app);

    // urlImportRateLimit is 5/min — fire 6 to trigger 429 on the last one.
    let lastStatus = 0;
    for (let i = 0; i < 6; i++) {
      const res = await request(app)
        .post("/api/meal-plan/recipes/parse-url")
        .set("Authorization", "Bearer token")
        .send({ url: "https://example.com/recipe" });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});
