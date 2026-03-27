import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { db } from "../../db";
import { register } from "../meal-plan";

import { generateMealPlanFromPantry } from "../../services/pantry-meal-plan";

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
    getPantryItems: vi.fn(),
    getUserProfile: vi.fn(),
    getUser: vi.fn(),
    reorderMealPlanItems: vi.fn(),
  },
}));

vi.mock("../../db", () => ({
  db: {
    transaction: vi.fn(),
  },
}));

vi.mock("../../services/meal-type-inference", () => ({
  inferMealTypes: vi.fn().mockReturnValue(["lunch"]),
}));

vi.mock("../../middleware/auth");

vi.mock("express-rate-limit");

vi.mock("../../services/pantry-meal-plan", () => ({
  generateMealPlanFromPantry: vi.fn(),
}));

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
      vi.mocked(storage.getUserMealPlanRecipes).mockResolvedValue([
        mockRecipe,
      ] as never);

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
      vi.mocked(storage.createMealPlanRecipe).mockResolvedValue(
        mockRecipe as never,
      );

      const res = await request(app)
        .post("/api/meal-plan/recipes")
        .set("Authorization", "Bearer token")
        .send({ title: "Chicken Salad" });

      expect(res.status).toBe(201);
    });

    it("creates a recipe with sourceType quick_entry", async () => {
      vi.mocked(storage.createMealPlanRecipe).mockResolvedValue({
        ...mockRecipe,
        sourceType: "quick_entry",
      } as never);

      const res = await request(app)
        .post("/api/meal-plan/recipes")
        .set("Authorization", "Bearer token")
        .send({
          title: "Chicken Stir Fry",
          sourceType: "quick_entry",
          caloriesPerServing: "350",
        });

      expect(res.status).toBe(201);
      expect(vi.mocked(storage.createMealPlanRecipe)).toHaveBeenCalledWith(
        expect.objectContaining({ sourceType: "quick_entry" }),
        undefined,
      );
    });

    it("defaults sourceType to user_created when omitted", async () => {
      vi.mocked(storage.createMealPlanRecipe).mockResolvedValue(
        mockRecipe as never,
      );

      await request(app)
        .post("/api/meal-plan/recipes")
        .set("Authorization", "Bearer token")
        .send({ title: "Test Recipe" });

      expect(vi.mocked(storage.createMealPlanRecipe)).toHaveBeenCalledWith(
        expect.objectContaining({ sourceType: "user_created" }),
        undefined,
      );
    });

    it("creates a recipe with sourceType ai_suggestion", async () => {
      vi.mocked(storage.createMealPlanRecipe).mockResolvedValue({
        ...mockRecipe,
        sourceType: "ai_suggestion",
      } as never);

      const res = await request(app)
        .post("/api/meal-plan/recipes")
        .set("Authorization", "Bearer token")
        .send({
          title: "AI Suggested Oatmeal",
          sourceType: "ai_suggestion",
          caloriesPerServing: "300",
        });

      expect(res.status).toBe(201);
      expect(vi.mocked(storage.createMealPlanRecipe)).toHaveBeenCalledWith(
        expect.objectContaining({ sourceType: "ai_suggestion" }),
        undefined,
      );
    });

    it("returns 400 for invalid sourceType", async () => {
      const res = await request(app)
        .post("/api/meal-plan/recipes")
        .set("Authorization", "Bearer token")
        .send({ title: "Test", sourceType: "invalid" });

      expect(res.status).toBe(400);
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
      vi.mocked(storage.getMealPlanRecipe).mockResolvedValue(
        mockRecipe as never,
      );
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

  describe("Error paths", () => {
    it("GET /api/meal-plan/recipes returns 500 on storage error", async () => {
      vi.mocked(storage.getUserMealPlanRecipes).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .get("/api/meal-plan/recipes")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
    });

    it("GET /api/meal-plan/recipes/:id returns 500 on storage error", async () => {
      vi.mocked(storage.getMealPlanRecipeWithIngredients).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .get("/api/meal-plan/recipes/1")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
    });

    it("POST /api/meal-plan/recipes returns 500 on storage error", async () => {
      vi.mocked(storage.createMealPlanRecipe).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .post("/api/meal-plan/recipes")
        .set("Authorization", "Bearer token")
        .send({ title: "Test" });

      expect(res.status).toBe(500);
    });

    it("PUT /api/meal-plan/recipes/:id returns 400 for invalid ID", async () => {
      const res = await request(app)
        .put("/api/meal-plan/recipes/abc")
        .set("Authorization", "Bearer token")
        .send({ title: "Updated" });

      expect(res.status).toBe(400);
    });

    it("PUT /api/meal-plan/recipes/:id returns 500 on storage error", async () => {
      vi.mocked(storage.updateMealPlanRecipe).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .put("/api/meal-plan/recipes/1")
        .set("Authorization", "Bearer token")
        .send({ title: "Updated" });

      expect(res.status).toBe(500);
    });

    it("DELETE /api/meal-plan/recipes/:id returns 400 for invalid ID", async () => {
      const res = await request(app)
        .delete("/api/meal-plan/recipes/abc")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
    });

    it("DELETE /api/meal-plan/recipes/:id returns 500 on storage error", async () => {
      vi.mocked(storage.deleteMealPlanRecipe).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .delete("/api/meal-plan/recipes/1")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
    });

    it("GET /api/meal-plan returns 500 on storage error", async () => {
      vi.mocked(storage.getMealPlanItems).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .get("/api/meal-plan?start=2025-01-01&end=2025-01-07")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
    });

    it("GET /api/meal-plan returns 400 for invalid calendar date", async () => {
      const res = await request(app)
        .get("/api/meal-plan?start=2025-02-30&end=2025-03-01")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
    });

    it("POST /api/meal-plan/items returns 400 for invalid date format", async () => {
      const res = await request(app)
        .post("/api/meal-plan/items")
        .set("Authorization", "Bearer token")
        .send({
          recipeId: 1,
          plannedDate: "not-a-date",
          mealType: "dinner",
        });

      expect(res.status).toBe(400);
    });

    it("POST /api/meal-plan/items adds scanned item to plan", async () => {
      vi.mocked(storage.getScannedItem).mockResolvedValue({
        id: 1,
        userId: "1",
      } as never);
      vi.mocked(storage.addMealPlanItem).mockResolvedValue({ id: 1 } as never);

      const res = await request(app)
        .post("/api/meal-plan/items")
        .set("Authorization", "Bearer token")
        .send({
          scannedItemId: 1,
          plannedDate: "2025-01-01",
          mealType: "snack",
        });

      expect(res.status).toBe(201);
    });

    it("POST /api/meal-plan/items returns 404 for scanned item not owned by user", async () => {
      // Storage layer now filters by userId, so mismatched user returns undefined
      vi.mocked(storage.getScannedItem).mockResolvedValue(undefined);

      const res = await request(app)
        .post("/api/meal-plan/items")
        .set("Authorization", "Bearer token")
        .send({
          scannedItemId: 1,
          plannedDate: "2025-01-01",
          mealType: "snack",
        });

      expect(res.status).toBe(404);
    });

    it("POST /api/meal-plan/items returns 500 on storage error", async () => {
      vi.mocked(storage.getMealPlanRecipe).mockResolvedValue(
        mockRecipe as never,
      );
      vi.mocked(storage.addMealPlanItem).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .post("/api/meal-plan/items")
        .set("Authorization", "Bearer token")
        .send({
          recipeId: 1,
          plannedDate: "2025-01-01",
          mealType: "dinner",
        });

      expect(res.status).toBe(500);
    });

    it("DELETE /api/meal-plan/items/:id returns 400 for invalid ID", async () => {
      const res = await request(app)
        .delete("/api/meal-plan/items/abc")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
    });

    it("DELETE /api/meal-plan/items/:id returns 500 on storage error", async () => {
      vi.mocked(storage.removeMealPlanItem).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .delete("/api/meal-plan/items/1")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
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
      vi.mocked(storage.getConfirmedMealPlanItemIds).mockResolvedValue(
        [] as never,
      );
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
      vi.mocked(storage.getConfirmedMealPlanItemIds).mockResolvedValue([
        1,
      ] as never);

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

    it("returns 400 for invalid ID", async () => {
      mockPremium();

      const res = await request(app)
        .post("/api/meal-plan/items/abc/confirm")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
    });

    it("returns 500 on storage error", async () => {
      mockPremium();
      vi.mocked(storage.getMealPlanItemById).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .post("/api/meal-plan/items/1/confirm")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
    });
  });

  // ============================================================================
  // PANTRY → MEAL PLAN GENERATION
  // ============================================================================

  describe("POST /api/meal-plan/generate-from-pantry", () => {
    const mockPantryItems = [
      { id: 1, userId: "1", name: "Chicken", category: "meat" },
      { id: 2, userId: "1", name: "Rice", category: "grains" },
    ];

    const mockPlan = {
      days: [
        {
          dayNumber: 1,
          meals: [
            {
              mealType: "lunch",
              title: "Chicken Rice",
              description: "Simple dish",
              servings: 1,
              prepTimeMinutes: 10,
              cookTimeMinutes: 20,
              difficulty: "Easy",
              ingredients: [{ name: "Chicken", quantity: "1", unit: "lb" }],
              instructions: "Cook it",
              dietTags: [],
              caloriesPerServing: 450,
              proteinPerServing: 40,
              carbsPerServing: 50,
              fatPerServing: 10,
            },
          ],
        },
      ],
    };

    it("returns 403 for free users", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "free",
      } as never);

      const res = await request(app)
        .post("/api/meal-plan/generate-from-pantry")
        .set("Authorization", "Bearer token")
        .send({ days: 3, startDate: "2026-03-15" });

      expect(res.status).toBe(403);
    });

    it("returns 400 for invalid days", async () => {
      mockPremium();

      const res = await request(app)
        .post("/api/meal-plan/generate-from-pantry")
        .set("Authorization", "Bearer token")
        .send({ days: 10, startDate: "2026-03-15" });

      expect(res.status).toBe(400);
    });

    it("returns 400 when pantry is empty", async () => {
      mockPremium();
      vi.mocked(storage.getPantryItems).mockResolvedValue([]);

      const res = await request(app)
        .post("/api/meal-plan/generate-from-pantry")
        .set("Authorization", "Bearer token")
        .send({ days: 3, startDate: "2026-03-15" });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("No pantry items");
    });

    it("generates meal plan successfully", async () => {
      mockPremium();
      vi.mocked(storage.getPantryItems).mockResolvedValue(
        mockPantryItems as never,
      );
      vi.mocked(storage.getUserProfile).mockResolvedValue(null as never);
      vi.mocked(storage.getUser).mockResolvedValue({
        dailyCalorieGoal: 2000,
        dailyProteinGoal: 150,
        dailyCarbsGoal: 250,
        dailyFatGoal: 67,
      } as never);
      vi.mocked(generateMealPlanFromPantry).mockResolvedValue(
        mockPlan as never,
      );

      const res = await request(app)
        .post("/api/meal-plan/generate-from-pantry")
        .set("Authorization", "Bearer token")
        .send({ days: 3, startDate: "2026-03-15" });

      expect(res.status).toBe(200);
      expect(res.body.days).toHaveLength(1);
      expect(generateMealPlanFromPantry).toHaveBeenCalledTimes(1);
    });

    it("returns 400 for invalid date format", async () => {
      mockPremium();

      const res = await request(app)
        .post("/api/meal-plan/generate-from-pantry")
        .set("Authorization", "Bearer token")
        .send({ days: 3, startDate: "March 15" });

      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/meal-plan/save-generated", () => {
    const validMeal = {
      mealType: "lunch",
      title: "Chicken Rice",
      description: "Simple dish",
      servings: 1,
      prepTimeMinutes: 10,
      cookTimeMinutes: 20,
      difficulty: "Easy",
      ingredients: [{ name: "Chicken", quantity: "1", unit: "lb" }],
      instructions: "Cook it",
      dietTags: [],
      caloriesPerServing: 450,
      proteinPerServing: 40,
      carbsPerServing: 50,
      fatPerServing: 10,
      plannedDate: "2026-03-15",
    };

    it("creates recipes and plan items", async () => {
      let insertCount = 0;
      vi.mocked(db.transaction).mockImplementation(async (cb) => {
        const fakeTx = {
          insert: () => ({
            values: () => ({
              returning: () => {
                insertCount++;
                // 1st insert = recipe, 2nd = ingredients (no returning), 3rd = plan item
                if (insertCount === 1)
                  return Promise.resolve([{ id: 10, userId: "1" }]);
                return Promise.resolve([{ id: 20 }]);
              },
            }),
          }),
        };
        return cb(fakeTx as never);
      });

      const res = await request(app)
        .post("/api/meal-plan/save-generated")
        .set("Authorization", "Bearer token")
        .send({ meals: [validMeal] });

      expect(res.status).toBe(201);
      expect(res.body.saved).toBe(1);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].recipeId).toBe(10);
      expect(res.body.items[0].mealPlanItemId).toBe(20);
    });

    it("returns 400 for empty meals array", async () => {
      const res = await request(app)
        .post("/api/meal-plan/save-generated")
        .set("Authorization", "Bearer token")
        .send({ meals: [] });

      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid date", async () => {
      const res = await request(app)
        .post("/api/meal-plan/save-generated")
        .set("Authorization", "Bearer token")
        .send({
          meals: [{ ...validMeal, plannedDate: "2026-02-30" }],
        });

      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid meal type", async () => {
      const res = await request(app)
        .post("/api/meal-plan/save-generated")
        .set("Authorization", "Bearer token")
        .send({
          meals: [{ ...validMeal, mealType: "brunch" }],
        });

      expect(res.status).toBe(400);
    });
  });
});
