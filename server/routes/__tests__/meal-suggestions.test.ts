import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

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
  },
}));

vi.mock("../../services/meal-suggestions", () => ({
  generateMealSuggestions: vi.fn(),
  buildSuggestionCacheKey: vi.fn(() => "cache-key"),
}));

vi.mock("../../utils/profile-hash", () => ({
  calculateProfileHash: vi.fn(() => "hash-123"),
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
import { generateMealSuggestions } from "../../services/meal-suggestions";
import { register } from "../meal-suggestions";

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
      } as never);
      vi.mocked(storage.getDailyMealSuggestionCount).mockResolvedValue(0 as never);
      vi.mocked(storage.getUserProfile).mockResolvedValue(null as never);
      vi.mocked(storage.getUser).mockResolvedValue({
        dailyCalorieGoal: 2000,
      } as never);
      vi.mocked(storage.getMealPlanItems).mockResolvedValue([] as never);
      vi.mocked(storage.getMealSuggestionCache).mockResolvedValue(null as never);
      vi.mocked(storage.getDailySummary).mockResolvedValue({
        totalCalories: "0",
        totalProtein: "0",
        totalCarbs: "0",
        totalFat: "0",
      } as never);
      const suggestions = [{ title: "Oatmeal", calories: 300 }];
      vi.mocked(generateMealSuggestions).mockResolvedValue(suggestions as never);
      vi.mocked(storage.createMealSuggestionCache).mockResolvedValue({} as never);

      const res = await request(app)
        .post("/api/meal-plan/suggest")
        .set("Authorization", "Bearer token")
        .send({ date: "2025-01-01", mealType: "breakfast" });

      expect(res.status).toBe(200);
      expect(res.body.suggestions).toHaveLength(1);
      expect(res.body.remainingToday).toBeDefined();
    });

    it("returns cached suggestions on cache hit", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "premium",
      } as never);
      vi.mocked(storage.getDailyMealSuggestionCount).mockResolvedValue(1 as never);
      vi.mocked(storage.getUserProfile).mockResolvedValue(null as never);
      vi.mocked(storage.getUser).mockResolvedValue({} as never);
      vi.mocked(storage.getMealPlanItems).mockResolvedValue([] as never);
      vi.mocked(storage.getMealSuggestionCache).mockResolvedValue({
        id: 1,
        suggestions: [{ title: "Cached Meal" }],
      } as never);
      vi.mocked(storage.incrementMealSuggestionCacheHit).mockResolvedValue({} as never);

      const res = await request(app)
        .post("/api/meal-plan/suggest")
        .set("Authorization", "Bearer token")
        .send({ date: "2025-01-01", mealType: "lunch" });

      expect(res.status).toBe(200);
      expect(res.body.suggestions[0].title).toBe("Cached Meal");
      expect(generateMealSuggestions).not.toHaveBeenCalled();
    });

    it("returns 403 for free tier", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "free",
      } as never);

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
      } as never);
      vi.mocked(storage.getDailyMealSuggestionCount).mockResolvedValue(100 as never);

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
  });
});
