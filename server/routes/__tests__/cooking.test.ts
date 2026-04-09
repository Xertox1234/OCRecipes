import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { register, MAX_PHOTOS_PER_SESSION } from "../cooking";
import {
  cookingSessionStore,
  COOKING_MAX_PER_USER,
  COOKING_MAX_GLOBAL,
} from "../../storage/sessions";
import { batchNutritionLookup } from "../../services/nutrition-lookup";
import type { NutritionData } from "../../services/nutrition-lookup";
import { generateRecipeContent } from "../../services/recipe-generation";
import { getSubstitutions } from "../../services/ingredient-substitution";
import {
  analyzeIngredientPhoto,
  IngredientAnalysisError,
} from "../../services/cooking-session";
import type {
  CookingSessionIngredient,
  RecipeContent,
  SubstitutionResult,
} from "@shared/types/cook-session";
import {
  createMockUserProfile,
  createMockNutritionData,
  createMockScannedItem,
} from "../../__tests__/factories";

vi.mock("../../storage", async () => {
  const sessions = await import("../../storage/sessions");
  return {
    storage: {
      getSubscriptionStatus: vi.fn(),
      getUserProfile: vi.fn(),
      createScannedItemWithLog: vi.fn(),
      cookingSessionStore: sessions.cookingSessionStore,
    },
  };
});

vi.mock("../../middleware/auth");

vi.mock("express-rate-limit");

vi.mock("../../lib/openai", () => ({
  isAiConfigured: true,
}));

// Mock only analyzeIngredientPhoto; let calculateSessionNutrition,
// calculateSessionMacros, and IngredientAnalysisError pass through to real
// implementations (nutrition functions use the mocked batchNutritionLookup
// and cooking-adjustment modules).
vi.mock("../../services/cooking-session", async () => {
  const actual = await vi.importActual("../../services/cooking-session");
  return {
    ...actual,
    analyzeIngredientPhoto: vi.fn(),
  };
});

vi.mock("../../services/nutrition-lookup", () => ({
  batchNutritionLookup: vi.fn(),
}));

vi.mock("../../services/cooking-adjustment", () => ({
  calculateCookedNutrition: vi.fn().mockReturnValue({
    calories: 150,
    protein: 25,
    carbs: 0,
    fat: 5,
    fiber: 0,
    sugar: 0,
    sodium: 60,
    adjustmentApplied: true,
  }),
  preparationToCookingMethod: vi.fn().mockReturnValue("grilled"),
}));

vi.mock("../../services/recipe-generation", () => ({
  generateRecipeContent: vi.fn(),
}));

vi.mock("../../services/ingredient-substitution", () => ({
  getSubstitutions: vi.fn(),
}));

const { mockFileBuffer } = vi.hoisted(() => ({
  mockFileBuffer: {
    current: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
  },
}));

vi.mock("multer", () => {
  const multerMock = () => ({
    single:
      () =>
      (
        req: express.Request,
        _res: express.Response,
        next: express.NextFunction,
      ) => {
        req.file = {
          buffer: mockFileBuffer.current,
          mimetype: "image/jpeg",
          originalname: "test.jpg",
          size: mockFileBuffer.current.length,
        } as Express.Multer.File;
        next();
      },
  });
  multerMock.memoryStorage = () => ({});
  return { default: multerMock };
});

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

function setupPremiumMock() {
  vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
    tier: "premium" as const,
    expiresAt: null,
  });
}

function setupFreeMock() {
  vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
    tier: "free" as const,
    expiresAt: null,
  });
}

const mockIngredient: CookingSessionIngredient = {
  id: "ing-1",
  name: "chicken breast",
  quantity: 200,
  unit: "g",
  confidence: 0.9,
  category: "protein",
  photoId: "photo-1",
  userEdited: false,
};

describe("Cooking Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    cookingSessionStore._internals.store.clear();
    cookingSessionStore._internals.userCount.clear();
    // Clear any pending timeouts
    for (const [, timeout] of cookingSessionStore._internals.timeouts) {
      clearTimeout(timeout);
    }
    cookingSessionStore._internals.timeouts.clear();
    app = createApp();
  });

  afterEach(() => {
    // Clean up any timeouts created during tests to prevent leaks
    for (const [, timeout] of cookingSessionStore._internals.timeouts) {
      clearTimeout(timeout);
    }
    cookingSessionStore._internals.timeouts.clear();
  });

  describe("POST /api/cooking/sessions", () => {
    it("creates a cooking session for premium user", async () => {
      setupPremiumMock();

      const res = await request(app)
        .post("/api/cooking/sessions")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.ingredients).toEqual([]);
      expect(res.body.photos).toEqual([]);
      expect(res.body.createdAt).toBeDefined();
    });

    it("returns 403 for free tier user", async () => {
      setupFreeMock();

      const res = await request(app)
        .post("/api/cooking/sessions")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(403);
    });

    it("returns 429 when user session limit is reached", async () => {
      setupPremiumMock();

      // Fill up user sessions for userId "1" (set by auth mock)
      for (let i = 0; i < COOKING_MAX_PER_USER; i++) {
        cookingSessionStore._internals.store.set(`existing-${i}`, {
          id: `existing-${i}`,
          userId: "1",
          ingredients: [],
          photos: [],
          createdAt: Date.now(),
        });
      }
      cookingSessionStore._internals.userCount.set("1", COOKING_MAX_PER_USER);

      const res = await request(app)
        .post("/api/cooking/sessions")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(429);
      expect(res.body.code).toBe("USER_SESSION_LIMIT");
    });

    it("returns 429 when global session limit is reached", async () => {
      setupPremiumMock();

      for (let i = 0; i < COOKING_MAX_GLOBAL; i++) {
        cookingSessionStore._internals.store.set(`global-${i}`, {
          id: `global-${i}`,
          userId: "other-user",
          ingredients: [],
          photos: [],
          createdAt: Date.now(),
        });
      }

      const res = await request(app)
        .post("/api/cooking/sessions")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(429);
      expect(res.body.code).toBe("SESSION_LIMIT_REACHED");
    });
  });

  describe("GET /api/cooking/sessions/:id", () => {
    it("returns a session for the owning user", async () => {
      const sessionId = "test-session-1";
      cookingSessionStore._internals.store.set(sessionId, {
        id: sessionId,
        userId: "1", // matches __mocks__/auth.ts req.userId
        ingredients: [mockIngredient],
        photos: [{ id: "photo-1", addedAt: Date.now() }],
        createdAt: Date.now(),
      });

      const res = await request(app)
        .get(`/api/cooking/sessions/${sessionId}`)
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(sessionId);
      expect(res.body.ingredients).toHaveLength(1);
      expect(res.body.photos).toHaveLength(1);
    });

    it("returns 404 for non-existent session", async () => {
      const res = await request(app)
        .get("/api/cooking/sessions/nonexistent")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(404);
      expect(res.body.code).toBe("SESSION_NOT_FOUND");
    });

    it("returns 403 when session belongs to another user", async () => {
      const sessionId = "other-user-session";
      cookingSessionStore._internals.store.set(sessionId, {
        id: sessionId,
        userId: "other-user-id",
        ingredients: [],
        photos: [],
        createdAt: Date.now(),
      });

      const res = await request(app)
        .get(`/api/cooking/sessions/${sessionId}`)
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/cooking/sessions/:id/photos", () => {
    it("analyzes a photo and adds detected ingredients", async () => {
      const sessionId = "photo-session";
      cookingSessionStore._internals.store.set(sessionId, {
        id: sessionId,
        userId: "1",
        ingredients: [],
        photos: [],
        createdAt: Date.now(),
      });

      vi.mocked(analyzeIngredientPhoto).mockResolvedValue([
        {
          id: "detected-1",
          name: "chicken breast",
          quantity: 200,
          unit: "g",
          confidence: 0.9,
          category: "protein",
          photoId: "",
          userEdited: false,
        },
      ]);

      vi.mocked(storage.getUserProfile).mockResolvedValue(undefined);

      const res = await request(app)
        .post(`/api/cooking/sessions/${sessionId}/photos`)
        .set("Authorization", "Bearer token")
        .attach("photo", Buffer.from("fake"), "test.jpg");

      expect(res.status).toBe(200);
      expect(res.body.ingredients).toHaveLength(1);
      expect(res.body.ingredients[0].name).toBe("chicken breast");
      expect(res.body.newDetections).toBe(1);
      expect(res.body.photos).toHaveLength(1);
    });

    it("returns 404 for non-existent session", async () => {
      const res = await request(app)
        .post("/api/cooking/sessions/nonexistent/photos")
        .set("Authorization", "Bearer token")
        .attach("photo", Buffer.from("fake"), "test.jpg");

      expect(res.status).toBe(404);
    });

    it("returns 400 when max photos reached", async () => {
      const sessionId = "full-photos-session";
      const photos = Array.from({ length: MAX_PHOTOS_PER_SESSION }, (_, i) => ({
        id: `photo-${i}`,
        addedAt: Date.now(),
      }));
      cookingSessionStore._internals.store.set(sessionId, {
        id: sessionId,
        userId: "1",
        ingredients: [],
        photos,
        createdAt: Date.now(),
      });

      const res = await request(app)
        .post(`/api/cooking/sessions/${sessionId}/photos`)
        .set("Authorization", "Bearer token")
        .attach("photo", Buffer.from("fake"), "test.jpg");

      expect(res.status).toBe(400);
    });

    it("returns 500 when analysis returns no content", async () => {
      const sessionId = "no-content-session";
      cookingSessionStore._internals.store.set(sessionId, {
        id: sessionId,
        userId: "1",
        ingredients: [],
        photos: [],
        createdAt: Date.now(),
      });

      vi.mocked(analyzeIngredientPhoto).mockRejectedValue(
        new IngredientAnalysisError("No response from ingredient analysis"),
      );

      const res = await request(app)
        .post(`/api/cooking/sessions/${sessionId}/photos`)
        .set("Authorization", "Bearer token")
        .attach("photo", Buffer.from("fake"), "test.jpg");

      expect(res.status).toBe(500);
    });

    it("returns 500 when analysis returns invalid JSON", async () => {
      const sessionId = "bad-json-session";
      cookingSessionStore._internals.store.set(sessionId, {
        id: sessionId,
        userId: "1",
        ingredients: [],
        photos: [],
        createdAt: Date.now(),
      });

      vi.mocked(analyzeIngredientPhoto).mockRejectedValue(
        new IngredientAnalysisError("Invalid JSON from ingredient analysis"),
      );

      const res = await request(app)
        .post(`/api/cooking/sessions/${sessionId}/photos`)
        .set("Authorization", "Bearer token")
        .attach("photo", Buffer.from("fake"), "test.jpg");

      expect(res.status).toBe(500);
    });

    it("returns allergen warnings when user has allergies", async () => {
      const sessionId = "allergen-session";
      cookingSessionStore._internals.store.set(sessionId, {
        id: sessionId,
        userId: "1",
        ingredients: [],
        photos: [],
        createdAt: Date.now(),
      });

      vi.mocked(analyzeIngredientPhoto).mockResolvedValue([
        {
          id: "detected-2",
          name: "peanut butter",
          quantity: 30,
          unit: "g",
          confidence: 0.95,
          category: "other",
          photoId: "",
          userEdited: false,
        },
      ]);

      vi.mocked(storage.getUserProfile).mockResolvedValue(
        createMockUserProfile({
          allergies: [{ name: "peanuts", severity: "severe" }],
        }),
      );

      const res = await request(app)
        .post(`/api/cooking/sessions/${sessionId}/photos`)
        .set("Authorization", "Bearer token")
        .attach("photo", Buffer.from("fake"), "test.jpg");

      expect(res.status).toBe(200);
      expect(res.body.allergenWarnings).toBeDefined();
    });
  });

  describe("PATCH /api/cooking/sessions/:id/ingredients/:ingredientId", () => {
    it("edits an ingredient name", async () => {
      const sessionId = "edit-session";
      cookingSessionStore._internals.store.set(sessionId, {
        id: sessionId,
        userId: "1",
        ingredients: [{ ...mockIngredient }],
        photos: [],
        createdAt: Date.now(),
      });

      const res = await request(app)
        .patch(`/api/cooking/sessions/${sessionId}/ingredients/ing-1`)
        .set("Authorization", "Bearer token")
        .send({ name: "grilled chicken" });

      expect(res.status).toBe(200);
      expect(res.body.ingredient.name).toBe("grilled chicken");
      expect(res.body.ingredient.userEdited).toBe(true);
    });

    it("edits ingredient quantity and unit", async () => {
      const sessionId = "edit-qty-session";
      cookingSessionStore._internals.store.set(sessionId, {
        id: sessionId,
        userId: "1",
        ingredients: [{ ...mockIngredient }],
        photos: [],
        createdAt: Date.now(),
      });

      const res = await request(app)
        .patch(`/api/cooking/sessions/${sessionId}/ingredients/ing-1`)
        .set("Authorization", "Bearer token")
        .send({ quantity: 300, unit: "g" });

      expect(res.status).toBe(200);
      expect(res.body.ingredient.quantity).toBe(300);
      expect(res.body.ingredient.unit).toBe("g");
    });

    it("returns 404 for non-existent ingredient", async () => {
      const sessionId = "edit-notfound-session";
      cookingSessionStore._internals.store.set(sessionId, {
        id: sessionId,
        userId: "1",
        ingredients: [{ ...mockIngredient }],
        photos: [],
        createdAt: Date.now(),
      });

      const res = await request(app)
        .patch(`/api/cooking/sessions/${sessionId}/ingredients/nonexistent`)
        .set("Authorization", "Bearer token")
        .send({ name: "new name" });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe("INGREDIENT_NOT_FOUND");
    });

    it("returns 400 for invalid edit data", async () => {
      const sessionId = "edit-invalid-session";
      cookingSessionStore._internals.store.set(sessionId, {
        id: sessionId,
        userId: "1",
        ingredients: [{ ...mockIngredient }],
        photos: [],
        createdAt: Date.now(),
      });

      const res = await request(app)
        .patch(`/api/cooking/sessions/${sessionId}/ingredients/ing-1`)
        .set("Authorization", "Bearer token")
        .send({ quantity: -5 }); // must be positive

      expect(res.status).toBe(400);
    });

    it("returns 404 for non-existent session", async () => {
      const res = await request(app)
        .patch("/api/cooking/sessions/nonexistent/ingredients/ing-1")
        .set("Authorization", "Bearer token")
        .send({ name: "test" });

      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/cooking/sessions/:id/ingredients/:ingredientId", () => {
    it("deletes an ingredient from the session", async () => {
      const sessionId = "delete-ing-session";
      cookingSessionStore._internals.store.set(sessionId, {
        id: sessionId,
        userId: "1",
        ingredients: [
          { ...mockIngredient },
          { ...mockIngredient, id: "ing-2", name: "rice" },
        ],
        photos: [],
        createdAt: Date.now(),
      });

      const res = await request(app)
        .delete(`/api/cooking/sessions/${sessionId}/ingredients/ing-1`)
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.ingredients).toHaveLength(1);
      expect(res.body.ingredients[0].name).toBe("rice");
    });

    it("returns 404 for non-existent ingredient", async () => {
      const sessionId = "delete-notfound-session";
      cookingSessionStore._internals.store.set(sessionId, {
        id: sessionId,
        userId: "1",
        ingredients: [{ ...mockIngredient }],
        photos: [],
        createdAt: Date.now(),
      });

      const res = await request(app)
        .delete(`/api/cooking/sessions/${sessionId}/ingredients/nonexistent`)
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(404);
      expect(res.body.code).toBe("INGREDIENT_NOT_FOUND");
    });

    it("returns 404 for non-existent session", async () => {
      const res = await request(app)
        .delete("/api/cooking/sessions/nonexistent/ingredients/ing-1")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/cooking/sessions/:id/nutrition", () => {
    it("returns nutrition summary for session ingredients", async () => {
      const sessionId = "nutrition-session";
      cookingSessionStore._internals.store.set(sessionId, {
        id: sessionId,
        userId: "1",
        ingredients: [{ ...mockIngredient }],
        photos: [],
        createdAt: Date.now(),
      });

      vi.mocked(batchNutritionLookup).mockResolvedValue(
        new Map<string, NutritionData | null>([
          [
            "200 g chicken breast",
            createMockNutritionData({
              calories: 330,
              protein: 62,
              carbs: 0,
              fat: 7.2,
              fiber: 0,
              sugar: 0,
              sodium: 120,
            }),
          ],
        ]),
      );

      const res = await request(app)
        .post(`/api/cooking/sessions/${sessionId}/nutrition`)
        .set("Authorization", "Bearer token")
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.total).toBeDefined();
      expect(res.body.total.calories).toBe(330);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].name).toBe("chicken breast");
    });

    it("returns 400 when session has no ingredients", async () => {
      const sessionId = "empty-nutrition-session";
      cookingSessionStore._internals.store.set(sessionId, {
        id: sessionId,
        userId: "1",
        ingredients: [],
        photos: [],
        createdAt: Date.now(),
      });

      const res = await request(app)
        .post(`/api/cooking/sessions/${sessionId}/nutrition`)
        .set("Authorization", "Bearer token")
        .send({});

      expect(res.status).toBe(400);
    });

    it("handles ingredients with no nutrition data", async () => {
      const sessionId = "no-nutrition-session";
      cookingSessionStore._internals.store.set(sessionId, {
        id: sessionId,
        userId: "1",
        ingredients: [{ ...mockIngredient }],
        photos: [],
        createdAt: Date.now(),
      });

      vi.mocked(batchNutritionLookup).mockResolvedValue(
        new Map<string, NutritionData | null>(),
      );

      const res = await request(app)
        .post(`/api/cooking/sessions/${sessionId}/nutrition`)
        .set("Authorization", "Bearer token")
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.total.calories).toBe(0);
      expect(res.body.items[0].calories).toBe(0);
    });

    it("applies cooking method adjustments", async () => {
      const sessionId = "cooking-method-session";
      cookingSessionStore._internals.store.set(sessionId, {
        id: sessionId,
        userId: "1",
        ingredients: [{ ...mockIngredient }],
        photos: [],
        createdAt: Date.now(),
      });

      vi.mocked(batchNutritionLookup).mockResolvedValue(
        new Map<string, NutritionData | null>([
          [
            "200 g chicken breast",
            createMockNutritionData({
              calories: 330,
              protein: 62,
              carbs: 0,
              fat: 7.2,
              fiber: 0,
              sugar: 0,
              sodium: 120,
            }),
          ],
        ]),
      );

      const res = await request(app)
        .post(`/api/cooking/sessions/${sessionId}/nutrition`)
        .set("Authorization", "Bearer token")
        .send({ cookingMethod: "grilled" });

      expect(res.status).toBe(200);
      // cookingMethod was applied, so values come from the mock
      expect(res.body.items[0].cookingMethodApplied).toBe("grilled");
    });

    it("returns 404 for non-existent session", async () => {
      const res = await request(app)
        .post("/api/cooking/sessions/nonexistent/nutrition")
        .set("Authorization", "Bearer token")
        .send({});

      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/cooking/sessions/:id/log", () => {
    it("logs a meal and clears the session", async () => {
      const sessionId = "log-session";
      cookingSessionStore._internals.store.set(sessionId, {
        id: sessionId,
        userId: "1",
        ingredients: [{ ...mockIngredient }],
        photos: [],
        createdAt: Date.now(),
      });

      vi.mocked(batchNutritionLookup).mockResolvedValue(
        new Map<string, NutritionData | null>([
          [
            "200 g chicken breast",
            createMockNutritionData({
              calories: 330,
              protein: 62,
              carbs: 0,
              fat: 7.2,
            }),
          ],
        ]),
      );

      const mockItem = createMockScannedItem({
        id: 42,
        userId: "1",
        productName: "chicken breast",
        calories: "330",
        protein: "62",
        carbs: "0",
        fat: "7",
        sourceType: "cook_session",
      });

      vi.mocked(storage.createScannedItemWithLog).mockResolvedValue(mockItem);

      const res = await request(app)
        .post(`/api/cooking/sessions/${sessionId}/log`)
        .set("Authorization", "Bearer token")
        .send({ mealType: "dinner" });

      expect(res.status).toBe(201);
      expect(res.body.sourceType).toBe("cook_session");
      expect(storage.createScannedItemWithLog).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "1",
          sourceType: "cook_session",
        }),
        expect.objectContaining({ mealType: "dinner" }),
      );
      // Session should be cleared
      expect(cookingSessionStore._internals.store.has(sessionId)).toBe(false);
    });

    it("returns 400 when session has no ingredients", async () => {
      const sessionId = "empty-log-session";
      cookingSessionStore._internals.store.set(sessionId, {
        id: sessionId,
        userId: "1",
        ingredients: [],
        photos: [],
        createdAt: Date.now(),
      });

      const res = await request(app)
        .post(`/api/cooking/sessions/${sessionId}/log`)
        .set("Authorization", "Bearer token")
        .send({});

      expect(res.status).toBe(400);
    });

    it("returns 404 for non-existent session", async () => {
      const res = await request(app)
        .post("/api/cooking/sessions/nonexistent/log")
        .set("Authorization", "Bearer token")
        .send({});

      expect(res.status).toBe(404);
    });

    it("returns 500 when database transaction fails", async () => {
      const sessionId = "log-error-session";
      cookingSessionStore._internals.store.set(sessionId, {
        id: sessionId,
        userId: "1",
        ingredients: [{ ...mockIngredient }],
        photos: [],
        createdAt: Date.now(),
      });

      vi.mocked(batchNutritionLookup).mockResolvedValue(
        new Map<string, NutritionData | null>(),
      );
      vi.mocked(storage.createScannedItemWithLog).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .post(`/api/cooking/sessions/${sessionId}/log`)
        .set("Authorization", "Bearer token")
        .send({});

      expect(res.status).toBe(500);
    });
  });

  describe("POST /api/cooking/sessions/:id/recipe", () => {
    it("generates a recipe from session ingredients", async () => {
      setupPremiumMock();

      const sessionId = "recipe-session";
      cookingSessionStore._internals.store.set(sessionId, {
        id: sessionId,
        userId: "1",
        ingredients: [{ ...mockIngredient }],
        photos: [],
        createdAt: Date.now(),
      });

      vi.mocked(storage.getUserProfile).mockResolvedValue(undefined);
      vi.mocked(generateRecipeContent).mockResolvedValue({
        title: "Grilled Chicken",
        description: "Simple grilled chicken breast",
        difficulty: "Easy",
        timeEstimate: "20 minutes",
        ingredients: [{ name: "chicken breast", quantity: "2", unit: "" }],
        instructions: ["Season and grill"],
        dietTags: [],
      } satisfies RecipeContent);

      const res = await request(app)
        .post(`/api/cooking/sessions/${sessionId}/recipe`)
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.title).toBe("Grilled Chicken");
    });

    it("returns 403 for free tier user", async () => {
      setupFreeMock();

      const sessionId = "recipe-free-session";
      cookingSessionStore._internals.store.set(sessionId, {
        id: sessionId,
        userId: "1",
        ingredients: [{ ...mockIngredient }],
        photos: [],
        createdAt: Date.now(),
      });

      const res = await request(app)
        .post(`/api/cooking/sessions/${sessionId}/recipe`)
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(403);
    });

    it("returns 400 when session has no ingredients", async () => {
      setupPremiumMock();

      const sessionId = "recipe-empty-session";
      cookingSessionStore._internals.store.set(sessionId, {
        id: sessionId,
        userId: "1",
        ingredients: [],
        photos: [],
        createdAt: Date.now(),
      });

      const res = await request(app)
        .post(`/api/cooking/sessions/${sessionId}/recipe`)
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
    });

    it("returns 500 when recipe generation fails", async () => {
      setupPremiumMock();

      const sessionId = "recipe-error-session";
      cookingSessionStore._internals.store.set(sessionId, {
        id: sessionId,
        userId: "1",
        ingredients: [{ ...mockIngredient }],
        photos: [],
        createdAt: Date.now(),
      });

      vi.mocked(storage.getUserProfile).mockResolvedValue(undefined);
      vi.mocked(generateRecipeContent).mockRejectedValue(new Error("AI error"));

      const res = await request(app)
        .post(`/api/cooking/sessions/${sessionId}/recipe`)
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
    });
  });

  describe("POST /api/cooking/sessions/:id/substitutions", () => {
    it("returns substitution suggestions for session ingredients", async () => {
      const sessionId = "sub-session";
      cookingSessionStore._internals.store.set(sessionId, {
        id: sessionId,
        userId: "1",
        ingredients: [{ ...mockIngredient }],
        photos: [],
        createdAt: Date.now(),
      });

      vi.mocked(storage.getUserProfile).mockResolvedValue(undefined);
      vi.mocked(getSubstitutions).mockResolvedValue({
        suggestions: [
          {
            originalIngredientId: "ing-1",
            substitute: "tofu",
            reason: "Plant-based alternative",
            ratio: "1:1",
            macroDelta: { calories: -50, protein: -10, carbs: 2, fat: -3 },
            confidence: 0.8,
          },
        ],
        dietaryProfileSummary: "No dietary restrictions",
      } satisfies SubstitutionResult);

      const res = await request(app)
        .post(`/api/cooking/sessions/${sessionId}/substitutions`)
        .set("Authorization", "Bearer token")
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.suggestions).toHaveLength(1);
      expect(res.body.suggestions[0].substitute).toBe("tofu");
    });

    it("returns 400 when session has no ingredients", async () => {
      const sessionId = "sub-empty-session";
      cookingSessionStore._internals.store.set(sessionId, {
        id: sessionId,
        userId: "1",
        ingredients: [],
        photos: [],
        createdAt: Date.now(),
      });

      const res = await request(app)
        .post(`/api/cooking/sessions/${sessionId}/substitutions`)
        .set("Authorization", "Bearer token")
        .send({});

      expect(res.status).toBe(400);
    });

    it("returns 400 when specified ingredientIds match no ingredients", async () => {
      const sessionId = "sub-nomatch-session";
      cookingSessionStore._internals.store.set(sessionId, {
        id: sessionId,
        userId: "1",
        ingredients: [{ ...mockIngredient }],
        photos: [],
        createdAt: Date.now(),
      });

      const res = await request(app)
        .post(`/api/cooking/sessions/${sessionId}/substitutions`)
        .set("Authorization", "Bearer token")
        .send({
          ingredientIds: ["550e8400-e29b-41d4-a716-446655440000"],
        });

      expect(res.status).toBe(400);
    });

    it("returns 404 for non-existent session", async () => {
      const res = await request(app)
        .post("/api/cooking/sessions/nonexistent/substitutions")
        .set("Authorization", "Bearer token")
        .send({});

      expect(res.status).toBe(404);
    });

    it("returns 500 when substitution service fails", async () => {
      const sessionId = "sub-error-session";
      cookingSessionStore._internals.store.set(sessionId, {
        id: sessionId,
        userId: "1",
        ingredients: [{ ...mockIngredient }],
        photos: [],
        createdAt: Date.now(),
      });

      vi.mocked(storage.getUserProfile).mockResolvedValue(undefined);
      vi.mocked(getSubstitutions).mockRejectedValue(new Error("AI error"));

      const res = await request(app)
        .post(`/api/cooking/sessions/${sessionId}/substitutions`)
        .set("Authorization", "Bearer token")
        .send({});

      expect(res.status).toBe(500);
    });
  });

  describe("Session internals", () => {
    it("clearCookSession removes session and decrements user count", () => {
      const sessionId = "clear-test";
      const userId = "user-123";
      cookingSessionStore._internals.store.set(sessionId, {
        id: sessionId,
        userId,
        ingredients: [],
        photos: [],
        createdAt: Date.now(),
      });
      cookingSessionStore._internals.userCount.set(userId, 2);

      cookingSessionStore.clear(sessionId);

      expect(cookingSessionStore._internals.store.has(sessionId)).toBe(false);
      expect(cookingSessionStore._internals.userCount.get(userId)).toBe(1);
    });

    it("clearCookSession removes user count entry when it reaches 0", () => {
      const sessionId = "clear-last";
      const userId = "user-456";
      cookingSessionStore._internals.store.set(sessionId, {
        id: sessionId,
        userId,
        ingredients: [],
        photos: [],
        createdAt: Date.now(),
      });
      cookingSessionStore._internals.userCount.set(userId, 1);

      cookingSessionStore.clear(sessionId);

      expect(cookingSessionStore._internals.userCount.has(userId)).toBe(false);
    });

    it("clearCookSession clears associated timeout", () => {
      const sessionId = "clear-timeout";
      const userId = "user-789";
      cookingSessionStore._internals.store.set(sessionId, {
        id: sessionId,
        userId,
        ingredients: [],
        photos: [],
        createdAt: Date.now(),
      });
      cookingSessionStore._internals.userCount.set(userId, 1);

      // Set up a timeout
      cookingSessionStore.resetTimeout(sessionId);
      expect(cookingSessionStore._internals.timeouts.has(sessionId)).toBe(true);

      cookingSessionStore.clear(sessionId);

      expect(cookingSessionStore._internals.timeouts.has(sessionId)).toBe(
        false,
      );
    });

    it("clearCookSession handles non-existent session gracefully", () => {
      expect(() => {
        cookingSessionStore.clear("nonexistent");
      }).not.toThrow();
    });
  });
});
