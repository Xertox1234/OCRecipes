import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { register } from "../goals";
import { createMockUser } from "../../__tests__/factories";

vi.mock("../../storage", () => ({
  storage: {
    getUser: vi.fn(),
    updateUser: vi.fn(),
    getUserProfile: vi.fn(),
    createUserProfile: vi.fn(),
    updateUserProfile: vi.fn(),
    upsertProfileWithOnboarding: vi.fn(),
    updateUserGoalsAndProfile: vi.fn(),
    getDailySummary: vi.fn(),
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

const mockUser = createMockUser({
  dailyCalorieGoal: 2000,
  dailyProteinGoal: 150,
  dailyCarbsGoal: 250,
  dailyFatGoal: 67,
  goalsCalculatedAt: new Date("2024-01-01"),
});

describe("Goals Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    app = createApp();
  });

  describe("GET /api/goals", () => {
    it("returns current goals", async () => {
      vi.mocked(storage.getUser).mockResolvedValue(mockUser);

      const res = await request(app)
        .get("/api/goals")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.dailyCalorieGoal).toBe(2000);
      expect(res.body.dailyProteinGoal).toBe(150);
      expect(res.body.dailyCarbsGoal).toBe(250);
      expect(res.body.dailyFatGoal).toBe(67);
    });

    it("returns 404 if user not found", async () => {
      vi.mocked(storage.getUser).mockResolvedValue(undefined);

      const res = await request(app)
        .get("/api/goals")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/goals/calculate", () => {
    it("calculates goals from physical profile", async () => {
      vi.mocked(storage.updateUserGoalsAndProfile).mockResolvedValue(mockUser);

      const res = await request(app)
        .post("/api/goals/calculate")
        .set("Authorization", "Bearer token")
        .send({
          weight: 75,
          height: 175,
          age: 30,
          gender: "male",
          activityLevel: "moderate",
          primaryGoal: "maintain",
        });

      expect(res.status).toBe(200);
      expect(typeof res.body.dailyCalories).toBe("number");
      expect(typeof res.body.dailyProtein).toBe("number");
      expect(typeof res.body.dailyCarbs).toBe("number");
      expect(typeof res.body.dailyFat).toBe("number");
      expect(res.body.profile.weight).toBe(75);
    });

    it("upserts profile with activity level and goal", async () => {
      vi.mocked(storage.updateUserGoalsAndProfile).mockResolvedValue(mockUser);

      const res = await request(app)
        .post("/api/goals/calculate")
        .set("Authorization", "Bearer token")
        .send({
          weight: 75,
          height: 175,
          age: 30,
          gender: "female",
          activityLevel: "sedentary",
          primaryGoal: "lose_weight",
        });

      expect(res.status).toBe(200);
      expect(storage.updateUserGoalsAndProfile).toHaveBeenCalledWith(
        mockUser.id,
        expect.objectContaining({
          dailyCalorieGoal: expect.any(Number),
          dailyProteinGoal: expect.any(Number),
        }),
        expect.objectContaining({
          activityLevel: "sedentary",
          primaryGoal: "lose_weight",
        }),
      );
    });

    it("returns 400 for missing required fields", async () => {
      const res = await request(app)
        .post("/api/goals/calculate")
        .set("Authorization", "Bearer token")
        .send({ weight: 75 });

      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid values", async () => {
      const res = await request(app)
        .post("/api/goals/calculate")
        .set("Authorization", "Bearer token")
        .send({
          weight: -10,
          height: 175,
          age: 30,
          gender: "male",
          activityLevel: "moderate",
          primaryGoal: "maintain",
        });

      expect(res.status).toBe(400);
    });
  });

  describe("PUT /api/goals", () => {
    it("updates calorie goal", async () => {
      const updated = createMockUser({ ...mockUser, dailyCalorieGoal: 2500 });
      vi.mocked(storage.updateUser).mockResolvedValue(updated);

      const res = await request(app)
        .put("/api/goals")
        .set("Authorization", "Bearer token")
        .send({ dailyCalorieGoal: 2500 });

      expect(res.status).toBe(200);
      expect(res.body.dailyCalorieGoal).toBe(2500);
    });

    it("updates multiple macro goals", async () => {
      const updated = createMockUser({
        ...mockUser,
        dailyProteinGoal: 200,
        dailyFatGoal: 80,
      });
      vi.mocked(storage.updateUser).mockResolvedValue(updated);

      const res = await request(app)
        .put("/api/goals")
        .set("Authorization", "Bearer token")
        .send({ dailyProteinGoal: 200, dailyFatGoal: 80 });

      expect(res.status).toBe(200);
      expect(res.body.dailyProteinGoal).toBe(200);
      expect(res.body.dailyFatGoal).toBe(80);
    });

    it("returns 400 for calorie goal below 500", async () => {
      const res = await request(app)
        .put("/api/goals")
        .set("Authorization", "Bearer token")
        .send({ dailyCalorieGoal: 100 });

      expect(res.status).toBe(400);
    });

    it("returns 400 for calorie goal above 10000", async () => {
      const res = await request(app)
        .put("/api/goals")
        .set("Authorization", "Bearer token")
        .send({ dailyCalorieGoal: 15000 });

      expect(res.status).toBe(400);
    });

    it("returns 404 if user not found", async () => {
      vi.mocked(storage.updateUser).mockResolvedValue(undefined);

      const res = await request(app)
        .put("/api/goals")
        .set("Authorization", "Bearer token")
        .send({ dailyCalorieGoal: 2000 });

      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/daily-budget", () => {
    const mockSummary = {
      totalCalories: 1200,
      totalProtein: 80,
      totalCarbs: 150,
      totalFat: 40,
      itemCount: 3,
    };

    beforeEach(() => {
      vi.mocked(storage.getUser).mockResolvedValue(mockUser);
      vi.mocked(storage.getDailySummary).mockResolvedValue(mockSummary);
    });

    it("returns budget with correct remaining calories", async () => {
      const res = await request(app)
        .get("/api/daily-budget")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.calorieGoal).toBe(2000);
      expect(res.body.foodCalories).toBe(1200);
      expect(res.body.remaining).toBe(800);
    });

    it("passes the X-Timezone header as tz to getDailySummary (non-UTC user)", async () => {
      // Regression test for C2: a non-UTC user's local midnight must not be
      // misclassified as the next UTC calendar day.
      const res = await request(app)
        .get("/api/daily-budget?date=2026-05-29")
        .set("Authorization", "Bearer token")
        .set("X-Timezone", "America/Los_Angeles");

      expect(res.status).toBe(200);
      // The tz must be forwarded — third arg to getDailySummary is "America/Los_Angeles"
      const callArgs = vi.mocked(storage.getDailySummary).mock.calls[0];
      expect(callArgs[2]).toBe("America/Los_Angeles");
    });

    it("defaults to UTC when X-Timezone header is absent", async () => {
      const res = await request(app)
        .get("/api/daily-budget")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      const callArgs = vi.mocked(storage.getDailySummary).mock.calls[0];
      expect(callArgs[2]).toBe("UTC");
    });

    it("falls back to UTC for an invalid X-Timezone value", async () => {
      const res = await request(app)
        .get("/api/daily-budget")
        .set("Authorization", "Bearer token")
        .set("X-Timezone", "Not/ATimezone");

      expect(res.status).toBe(200);
      const callArgs = vi.mocked(storage.getDailySummary).mock.calls[0];
      expect(callArgs[2]).toBe("UTC");
    });
  });
});
