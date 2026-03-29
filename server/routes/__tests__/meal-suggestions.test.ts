import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { generateMealSuggestions } from "../../services/meal-suggestions";
import { register } from "../meal-suggestions";
import {
  createMockUser,
  createMockMealPlanItem,
  createMockMealPlanRecipe,
  createMockScannedItem,
  createMockMealSuggestionCache,
} from "../../__tests__/factories";
import type { MealSuggestion } from "@shared/types/meal-suggestions";

function createMockMealSuggestion(
  overrides: Partial<MealSuggestion> = {},
): MealSuggestion {
  return {
    title: "Test Meal",
    description: "A test meal suggestion",
    reasoning: "Fits your nutritional goals",
    calories: 300,
    protein: 20,
    carbs: 30,
    fat: 10,
    prepTimeMinutes: 15,
    difficulty: "Easy",
    ingredients: [{ name: "Test ingredient", quantity: "1", unit: "cup" }],
    instructions: "Test instructions",
    dietTags: [],
    ...overrides,
  };
}

vi.mock("../../storage", () => ({
  storage: {
    getSubscriptionStatus: vi.fn(),
    getDailyMealSuggestionCount: vi.fn(),
    getUserProfile: vi.fn(),
    getUser: vi.fn(),
    getMealPlanItems: vi.fn(),
    getMealSuggestionCache: vi.fn(),
    incrementMealSuggestionCacheHit: vi.fn(),
    getDailySummary: vi.fn(),
    createMealSuggestionCache: vi.fn(),
    createMealSuggestionCacheWithLimitCheck: vi.fn(),
    getPopularPicksByMealType: vi.fn(),
  },
}));

vi.mock("../../lib/openai", () => ({ isAiConfigured: true }));

vi.mock("../../services/meal-suggestions", () => ({
  generateMealSuggestions: vi.fn(),
  buildSuggestionCacheKey: vi.fn(() => "cache-key"),
}));

vi.mock("../../utils/profile-hash", () => ({
  calculateProfileHash: vi.fn(() => "hash-123"),
}));

vi.mock("../../middleware/auth");

vi.mock("express-rate-limit");

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

describe("Meal Suggestions Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  describe("POST /api/meal-plan/suggest", () => {
    it("returns suggestions for premium user", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "premium",
        expiresAt: null,
      });
      vi.mocked(storage.getDailyMealSuggestionCount).mockResolvedValue(0);
      vi.mocked(storage.getUserProfile).mockResolvedValue(undefined);
      vi.mocked(storage.getUser).mockResolvedValue(
        createMockUser({ dailyCalorieGoal: 2000 }),
      );
      vi.mocked(storage.getMealPlanItems).mockResolvedValue([]);
      vi.mocked(storage.getMealSuggestionCache).mockResolvedValue(undefined);
      vi.mocked(storage.getDailySummary).mockResolvedValue({
        totalCalories: 0,
        totalProtein: 0,
        totalCarbs: 0,
        totalFat: 0,
        itemCount: 0,
      });
      vi.mocked(storage.getPopularPicksByMealType).mockResolvedValue([]);
      const suggestions = [
        createMockMealSuggestion({ title: "Oatmeal", calories: 300 }),
      ];
      vi.mocked(generateMealSuggestions).mockResolvedValue(suggestions);
      vi.mocked(
        storage.createMealSuggestionCacheWithLimitCheck,
      ).mockResolvedValue(createMockMealSuggestionCache());

      const res = await request(app)
        .post("/api/meal-plan/suggest")
        .set("Authorization", "Bearer token")
        .send({ date: "2025-01-01", mealType: "breakfast" });

      expect(res.status).toBe(200);
      expect(res.body.suggestions).toHaveLength(1);
      expect(res.body.popularPicks).toEqual([]);
      expect(res.body.remainingToday).toBeDefined();
    });

    it("returns cached suggestions on cache hit", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "premium",
        expiresAt: null,
      });
      vi.mocked(storage.getDailyMealSuggestionCount).mockResolvedValue(1);
      vi.mocked(storage.getUserProfile).mockResolvedValue(undefined);
      vi.mocked(storage.getUser).mockResolvedValue(createMockUser());
      vi.mocked(storage.getMealPlanItems).mockResolvedValue([]);
      vi.mocked(storage.getMealSuggestionCache).mockResolvedValue(
        createMockMealSuggestionCache({
          id: 1,
          suggestions: [{ title: "Cached Meal" }],
        }),
      );
      vi.mocked(storage.incrementMealSuggestionCacheHit).mockResolvedValue(
        undefined,
      );
      vi.mocked(storage.getPopularPicksByMealType).mockResolvedValue([]);

      const res = await request(app)
        .post("/api/meal-plan/suggest")
        .set("Authorization", "Bearer token")
        .send({ date: "2025-01-01", mealType: "lunch" });

      expect(res.status).toBe(200);
      expect(res.body.suggestions[0].title).toBe("Cached Meal");
      expect(res.body.popularPicks).toEqual([]);
      expect(generateMealSuggestions).not.toHaveBeenCalled();
    });

    it("returns 403 for free tier", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "free",
        expiresAt: null,
      });

      const res = await request(app)
        .post("/api/meal-plan/suggest")
        .set("Authorization", "Bearer token")
        .send({ date: "2025-01-01", mealType: "breakfast" });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("PREMIUM_REQUIRED");
    });

    it("returns 429 when daily limit reached", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "premium",
        expiresAt: null,
      });
      vi.mocked(storage.getDailyMealSuggestionCount).mockResolvedValue(100);

      const res = await request(app)
        .post("/api/meal-plan/suggest")
        .set("Authorization", "Bearer token")
        .send({ date: "2025-01-01", mealType: "breakfast" });

      expect(res.status).toBe(429);
    });

    it("returns 400 for invalid date", async () => {
      const res = await request(app)
        .post("/api/meal-plan/suggest")
        .set("Authorization", "Bearer token")
        .send({ date: "not-a-date", mealType: "breakfast" });

      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid mealType", async () => {
      const res = await request(app)
        .post("/api/meal-plan/suggest")
        .set("Authorization", "Bearer token")
        .send({ date: "2025-01-01", mealType: "brunch" });

      expect(res.status).toBe(400);
    });

    it("returns 500 on storage error", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "premium",
        expiresAt: null,
      });
      vi.mocked(storage.getDailyMealSuggestionCount).mockResolvedValue(0);
      vi.mocked(storage.getUserProfile).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .post("/api/meal-plan/suggest")
        .set("Authorization", "Bearer token")
        .send({ date: "2025-01-01", mealType: "breakfast" });

      expect(res.status).toBe(500);
    });

    function mockBudgetSetup(
      mealPlanItems: Awaited<ReturnType<typeof storage.getMealPlanItems>>,
    ) {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "premium",
        expiresAt: null,
      });
      vi.mocked(storage.getDailyMealSuggestionCount).mockResolvedValue(0);
      vi.mocked(storage.getUserProfile).mockResolvedValue(undefined);
      vi.mocked(storage.getUser).mockResolvedValue(
        createMockUser({ dailyCalorieGoal: 2000 }),
      );
      vi.mocked(storage.getMealPlanItems).mockResolvedValue(mealPlanItems);
      vi.mocked(storage.getMealSuggestionCache).mockResolvedValue(undefined);
      vi.mocked(storage.getDailySummary).mockResolvedValue({
        totalCalories: 0,
        totalProtein: 0,
        totalCarbs: 0,
        totalFat: 0,
        itemCount: 0,
      });
      vi.mocked(storage.getPopularPicksByMealType).mockResolvedValue([]);
      vi.mocked(generateMealSuggestions).mockResolvedValue([]);
      vi.mocked(
        storage.createMealSuggestionCacheWithLimitCheck,
      ).mockResolvedValue(createMockMealSuggestionCache());
    }

    it("accounts for existing meal plan items with recipe data in budget", async () => {
      mockBudgetSetup([
        {
          ...createMockMealPlanItem({ mealType: "breakfast", servings: "2" }),
          recipe: createMockMealPlanRecipe({
            title: "Oatmeal",
            caloriesPerServing: "300",
            proteinPerServing: "10",
            carbsPerServing: "50",
            fatPerServing: "5",
          }),
          scannedItem: null,
        },
      ]);

      const res = await request(app)
        .post("/api/meal-plan/suggest")
        .set("Authorization", "Bearer token")
        .send({ date: "2025-01-01", mealType: "lunch" });

      expect(res.status).toBe(200);
      expect(generateMealSuggestions).toHaveBeenCalled();
    });

    it("accounts for existing meal plan items with scannedItem data in budget", async () => {
      mockBudgetSetup([
        {
          ...createMockMealPlanItem({ mealType: "snack", servings: "1" }),
          recipe: null,
          scannedItem: createMockScannedItem({
            productName: "Apple",
            calories: "95",
            protein: "0",
            carbs: "25",
            fat: "0",
          }),
        },
      ]);

      const res = await request(app)
        .post("/api/meal-plan/suggest")
        .set("Authorization", "Bearer token")
        .send({ date: "2025-01-01", mealType: "lunch" });

      expect(res.status).toBe(200);
    });

    it("returns popular picks in response", async () => {
      mockBudgetSetup([]);
      vi.mocked(storage.getPopularPicksByMealType).mockResolvedValue([
        {
          title: "Avocado Toast",
          description: "Simple and nutritious",
          calories: "350",
          protein: "12",
          carbs: "30",
          fat: "20",
          prepTimeMinutes: 10,
          difficulty: "Easy",
          dietTags: ["vegetarian"],
          pickCount: 5,
        },
      ]);

      const res = await request(app)
        .post("/api/meal-plan/suggest")
        .set("Authorization", "Bearer token")
        .send({ date: "2025-01-01", mealType: "breakfast" });

      expect(res.status).toBe(200);
      expect(res.body.popularPicks).toHaveLength(1);
      expect(res.body.popularPicks[0].title).toBe("Avocado Toast");
      expect(res.body.popularPicks[0].pickCount).toBe(5);
    });

    it("deduplicates popular picks that match AI suggestion titles", async () => {
      mockBudgetSetup([]);
      vi.mocked(generateMealSuggestions).mockResolvedValue([
        createMockMealSuggestion({ title: "Avocado Toast", calories: 350 }),
      ]);
      vi.mocked(storage.getPopularPicksByMealType).mockResolvedValue([
        {
          title: "avocado toast",
          description: null,
          calories: "350",
          protein: "12",
          carbs: "30",
          fat: "20",
          prepTimeMinutes: 10,
          difficulty: "Easy",
          dietTags: [],
          pickCount: 3,
        },
        {
          title: "Granola Bowl",
          description: "Crunchy and filling",
          calories: "400",
          protein: "15",
          carbs: "50",
          fat: "18",
          prepTimeMinutes: 5,
          difficulty: "Easy",
          dietTags: [],
          pickCount: 2,
        },
      ]);

      const res = await request(app)
        .post("/api/meal-plan/suggest")
        .set("Authorization", "Bearer token")
        .send({ date: "2025-01-01", mealType: "breakfast" });

      expect(res.status).toBe(200);
      expect(res.body.popularPicks).toHaveLength(1);
      expect(res.body.popularPicks[0].title).toBe("Granola Bowl");
    });
  });
});
