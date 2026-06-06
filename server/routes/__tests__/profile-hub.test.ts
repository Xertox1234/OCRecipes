import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { register } from "../profile-hub";

vi.mock("../../storage", () => ({
  storage: {
    getUser: vi.fn(),
    getDailySummary: vi.fn(),
    getLibraryCounts: vi.fn(),
    getSubscriptionStatus: vi.fn(),
  },
}));

vi.mock("../../middleware/auth");
vi.mock("express-rate-limit");

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

describe("profile-hub routes", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // --------------------------------------------------------------------------
  // GET /api/profile/widgets
  // --------------------------------------------------------------------------
  describe("GET /api/profile/widgets", () => {
    const mockUser = {
      id: "1",
      username: "test",
      dailyCalorieGoal: 2000,
    };

    const mockSummary = {
      totalCalories: 850,
      totalProtein: 45,
      totalCarbs: 100,
      totalFat: 30,
      itemCount: 3,
    };

    it("returns widget data for authenticated user", async () => {
      vi.mocked(storage.getUser).mockResolvedValue(mockUser as any);
      vi.mocked(storage.getDailySummary).mockResolvedValue(mockSummary as any);

      const res = await request(app).get("/api/profile/widgets");

      expect(res.status).toBe(200);
      expect(res.body.dailyBudget).toEqual({
        calorieGoal: 2000,
        foodCalories: 850,
        remaining: 1150,
      });
    });

    it("uses default calorie goal when user has none set", async () => {
      vi.mocked(storage.getUser).mockResolvedValue({
        ...mockUser,
        dailyCalorieGoal: null,
      } as any);
      vi.mocked(storage.getDailySummary).mockResolvedValue({
        totalCalories: 0,
        totalProtein: 0,
        totalCarbs: 0,
        totalFat: 0,
        itemCount: 0,
      } as any);

      const res = await request(app).get("/api/profile/widgets");

      expect(res.status).toBe(200);
      // Default from DEFAULT_NUTRITION_GOALS.calories
      expect(res.body.dailyBudget.calorieGoal).toBeGreaterThan(0);
    });

    it("returns 404 when user not found", async () => {
      vi.mocked(storage.getUser).mockResolvedValue(undefined as any);
      vi.mocked(storage.getDailySummary).mockResolvedValue({
        totalCalories: 0,
        totalProtein: 0,
        totalCarbs: 0,
        totalFat: 0,
        itemCount: 0,
      } as any);

      const res = await request(app).get("/api/profile/widgets");

      expect(res.status).toBe(404);
    });

    it("returns 500 on storage error", async () => {
      vi.mocked(storage.getUser).mockRejectedValue(new Error("DB error"));
      vi.mocked(storage.getDailySummary).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app).get("/api/profile/widgets");

      expect(res.status).toBe(500);
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/profile/library-counts
  // --------------------------------------------------------------------------
  describe("GET /api/profile/library-counts", () => {
    it("returns all counts for user with data", async () => {
      vi.mocked(storage.getLibraryCounts).mockResolvedValue({
        cookbooks: 3,
        savedItems: 12,
        scanHistory: 47,
        groceryLists: 2,
        pantryItems: 8,
        featuredRecipes: 156,
        favouriteRecipes: 5,
      });

      const res = await request(app).get("/api/profile/library-counts");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        cookbooks: 3,
        savedItems: 12,
        scanHistory: 47,
        groceryLists: 2,
        pantryItems: 8,
        featuredRecipes: 156,
        favouriteRecipes: 5,
      });
    });

    it("returns all zeros for new user", async () => {
      vi.mocked(storage.getLibraryCounts).mockResolvedValue({
        cookbooks: 0,
        savedItems: 0,
        scanHistory: 0,
        groceryLists: 0,
        pantryItems: 0,
        featuredRecipes: 0,
        favouriteRecipes: 0,
      });

      const res = await request(app).get("/api/profile/library-counts");

      expect(res.status).toBe(200);
      expect(res.body.cookbooks).toBe(0);
      expect(res.body.savedItems).toBe(0);
      expect(res.body.scanHistory).toBe(0);
    });

    it("returns 500 on storage error", async () => {
      vi.mocked(storage.getLibraryCounts).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app).get("/api/profile/library-counts");

      expect(res.status).toBe(500);
    });
  });
});
