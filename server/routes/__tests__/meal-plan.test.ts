import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../../storage", () => ({
  storage: {
    getSubscriptionStatus: vi.fn(),
    getUserMealPlanRecipes: vi.fn(),
    getMealPlanRecipeWithIngredients: vi.fn(),
    getMealPlanRecipe: vi.fn(),
    createMealPlanRecipe: vi.fn(),
    updateMealPlanRecipe: vi.fn(),
    deleteMealPlanRecipe: vi.fn(),
    getMealPlanItems: vi.fn(),
    addMealPlanItem: vi.fn(),
    getScannedItem: vi.fn(),
    removeMealPlanItem: vi.fn(),
    getMealPlanItemById: vi.fn(),
    getConfirmedMealPlanItemIds: vi.fn(),
    createDailyLog: vi.fn(),
  },
}));

vi.mock("../../middleware/auth", () => ({
  requireAuth: (
    req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => {
    req.userId = "1";
    next();
  },
}));

vi.mock("express-rate-limit", () => ({
  rateLimit: () =>
    (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
      next(),
  default: () =>
    (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
      next(),
}));

import { storage } from "../../storage";
import { register } from "../meal-plan";

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

const mockRecipe = {
  id: 1,
  userId: "1",
  title: "Chicken Salad",
  sourceType: "user_created",
};

describe("Meal Plan Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  describe("GET /api/meal-plan/recipes", () => {
    it("returns user recipes", async () => {
      vi.mocked(storage.getUserMealPlanRecipes).mockResolvedValue([mockRecipe] as never);

      const res = await request(app)
        .get("/api/meal-plan/recipes")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });
  });

  describe("GET /api/meal-plan/recipes/:id", () => {
    it("returns recipe with ingredients", async () => {
      vi.mocked(storage.getMealPlanRecipeWithIngredients).mockResolvedValue(
        mockRecipe as never,
      );

      const res = await request(app)
        .get("/api/meal-plan/recipes/1")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.title).toBe("Chicken Salad");
    });

    it("returns 404 for other user's recipe", async () => {
      vi.mocked(storage.getMealPlanRecipeWithIngredients).mockResolvedValue({
        ...mockRecipe,
        userId: "2",
      } as never);

      const res = await request(app)
        .get("/api/meal-plan/recipes/1")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(404);
    });

    it("returns 400 for invalid ID", async () => {
      const res = await request(app)
        .get("/api/meal-plan/recipes/abc")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/meal-plan/recipes", () => {
    it("creates a recipe", async () => {
      vi.mocked(storage.createMealPlanRecipe).mockResolvedValue(mockRecipe as never);

      const res = await request(app)
        .post("/api/meal-plan/recipes")
        .set("Authorization", "Bearer token")
        .send({ title: "Chicken Salad" });

      expect(res.status).toBe(201);
    });

    it("returns 400 for missing title", async () => {
      const res = await request(app)
        .post("/api/meal-plan/recipes")
        .set("Authorization", "Bearer token")
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe("PUT /api/meal-plan/recipes/:id", () => {
    it("updates a recipe", async () => {
      vi.mocked(storage.updateMealPlanRecipe).mockResolvedValue({
        ...mockRecipe,
        title: "Updated",
      } as never);

      const res = await request(app)
        .put("/api/meal-plan/recipes/1")
        .set("Authorization", "Bearer token")
        .send({ title: "Updated" });

      expect(res.status).toBe(200);
    });

    it("returns 404 for not found", async () => {
      vi.mocked(storage.updateMealPlanRecipe).mockResolvedValue(null as never);

      const res = await request(app)
        .put("/api/meal-plan/recipes/999")
        .set("Authorization", "Bearer token")
        .send({ title: "Updated" });

      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/meal-plan/recipes/:id", () => {
    it("deletes a recipe", async () => {
      vi.mocked(storage.deleteMealPlanRecipe).mockResolvedValue(true as never);

      const res = await request(app)
        .delete("/api/meal-plan/recipes/1")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(204);
    });

    it("returns 404 when not found", async () => {
      vi.mocked(storage.deleteMealPlanRecipe).mockResolvedValue(false as never);

      const res = await request(app)
        .delete("/api/meal-plan/recipes/999")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/meal-plan", () => {
    it("returns meal plan items for date range", async () => {
      vi.mocked(storage.getMealPlanItems).mockResolvedValue([] as never);

      const res = await request(app)
        .get("/api/meal-plan?start=2025-01-01&end=2025-01-07")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
    });

    it("returns 400 for missing dates", async () => {
      const res = await request(app)
        .get("/api/meal-plan")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
    });

    it("returns 400 when start after end", async () => {
      const res = await request(app)
        .get("/api/meal-plan?start=2025-01-10&end=2025-01-01")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
    });

    it("returns 400 for range exceeding 90 days", async () => {
      const res = await request(app)
        .get("/api/meal-plan?start=2025-01-01&end=2025-12-31")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/meal-plan/items", () => {
    it("adds recipe to meal plan", async () => {
      vi.mocked(storage.getMealPlanRecipe).mockResolvedValue(mockRecipe as never);
      vi.mocked(storage.addMealPlanItem).mockResolvedValue({ id: 1 } as never);

      const res = await request(app)
        .post("/api/meal-plan/items")
        .set("Authorization", "Bearer token")
        .send({
          recipeId: 1,
          plannedDate: "2025-01-01",
          mealType: "dinner",
        });

      expect(res.status).toBe(201);
    });

    it("returns 400 without recipeId or scannedItemId", async () => {
      const res = await request(app)
        .post("/api/meal-plan/items")
        .set("Authorization", "Bearer token")
        .send({
          plannedDate: "2025-01-01",
          mealType: "dinner",
        });

      expect(res.status).toBe(400);
    });

    it("returns 404 for recipe not owned by user", async () => {
      vi.mocked(storage.getMealPlanRecipe).mockResolvedValue({
        ...mockRecipe,
        userId: "2",
      } as never);

      const res = await request(app)
        .post("/api/meal-plan/items")
        .set("Authorization", "Bearer token")
        .send({
          recipeId: 1,
          plannedDate: "2025-01-01",
          mealType: "dinner",
        });

      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/meal-plan/items/:id", () => {
    it("removes item from plan", async () => {
      vi.mocked(storage.removeMealPlanItem).mockResolvedValue(true as never);

      const res = await request(app)
        .delete("/api/meal-plan/items/1")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(204);
    });

    it("returns 404 when not found", async () => {
      vi.mocked(storage.removeMealPlanItem).mockResolvedValue(false as never);

      const res = await request(app)
        .delete("/api/meal-plan/items/999")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/meal-plan/items/:id/confirm", () => {
    it("confirms a meal plan item", async () => {
      mockPremium();
      vi.mocked(storage.getMealPlanItemById).mockResolvedValue({
        id: 1,
        userId: "1",
        plannedDate: "2025-01-01",
        mealType: "dinner",
        servings: "1",
      } as never);
      vi.mocked(storage.getConfirmedMealPlanItemIds).mockResolvedValue([] as never);
      vi.mocked(storage.createDailyLog).mockResolvedValue({ id: 1 } as never);

      const res = await request(app)
        .post("/api/meal-plan/items/1/confirm")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(201);
    });

    it("returns 409 for already confirmed", async () => {
      mockPremium();
      vi.mocked(storage.getMealPlanItemById).mockResolvedValue({
        id: 1,
        userId: "1",
        plannedDate: "2025-01-01",
      } as never);
      vi.mocked(storage.getConfirmedMealPlanItemIds).mockResolvedValue([1] as never);

      const res = await request(app)
        .post("/api/meal-plan/items/1/confirm")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(409);
    });

    it("returns 404 when item not found", async () => {
      mockPremium();
      vi.mocked(storage.getMealPlanItemById).mockResolvedValue(null as never);

      const res = await request(app)
        .post("/api/meal-plan/items/999/confirm")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(404);
    });

    it("returns 403 for free tier", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue(null as never);

      const res = await request(app)
        .post("/api/meal-plan/items/1/confirm")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("PREMIUM_REQUIRED");
    });
  });
});
