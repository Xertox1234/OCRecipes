import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../../storage", () => ({
  storage: {
    getSubscriptionStatus: vi.fn(),
    getUser: vi.fn(),
    updateUser: vi.fn(),
    createGoalAdjustmentLog: vi.fn(),
    getGoalAdjustmentLogs: vi.fn(),
  },
}));

vi.mock("../../services/adaptive-goals", () => ({
  computeAdaptiveGoals: vi.fn(),
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
import { computeAdaptiveGoals } from "../../services/adaptive-goals";
import { register } from "../adaptive-goals";

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

const mockRecommendation = {
  newCalories: 2200,
  newProtein: 120,
  newCarbs: 260,
  newFat: 70,
  previousCalories: 2000,
  previousProtein: 100,
  previousCarbs: 250,
  previousFat: 65,
  reason: "Weight trending down, increasing calories",
  weightTrendRate: -0.5,
};

describe("Adaptive Goals Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  describe("GET /api/goals/adaptive", () => {
    it("returns adaptive goals status", async () => {
      mockPremium();
      vi.mocked(storage.getUser).mockResolvedValue({
        adaptiveGoalsEnabled: true,
      } as never);
      vi.mocked(computeAdaptiveGoals).mockResolvedValue(mockRecommendation as never);

      const res = await request(app)
        .get("/api/goals/adaptive")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(true);
      expect(res.body.hasRecommendation).toBe(true);
      expect(res.body.recommendation).toBeDefined();
    });

    it("returns 403 for free tier", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue(null as never);

      const res = await request(app)
        .get("/api/goals/adaptive")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("PREMIUM_REQUIRED");
    });

    it("returns no recommendation when null", async () => {
      mockPremium();
      vi.mocked(storage.getUser).mockResolvedValue({
        adaptiveGoalsEnabled: false,
      } as never);
      vi.mocked(computeAdaptiveGoals).mockResolvedValue(null as never);

      const res = await request(app)
        .get("/api/goals/adaptive")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(false);
      expect(res.body.hasRecommendation).toBe(false);
      expect(res.body.recommendation).toBeNull();
    });
  });

  describe("POST /api/goals/adaptive/accept", () => {
    it("applies recommended goals", async () => {
      mockPremium();
      vi.mocked(computeAdaptiveGoals).mockResolvedValue(mockRecommendation as never);
      vi.mocked(storage.updateUser).mockResolvedValue({} as never);
      vi.mocked(storage.createGoalAdjustmentLog).mockResolvedValue({} as never);

      const res = await request(app)
        .post("/api/goals/adaptive/accept")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.appliedGoals.calories).toBe(2200);
      expect(storage.updateUser).toHaveBeenCalledWith("1", expect.objectContaining({
        dailyCalorieGoal: 2200,
        dailyProteinGoal: 120,
      }));
      expect(storage.createGoalAdjustmentLog).toHaveBeenCalledWith(
        expect.objectContaining({ acceptedByUser: true }),
      );
    });

    it("returns 400 when no recommendation", async () => {
      mockPremium();
      vi.mocked(computeAdaptiveGoals).mockResolvedValue(null as never);

      const res = await request(app)
        .post("/api/goals/adaptive/accept")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/goals/adaptive/dismiss", () => {
    it("logs dismissed adjustment", async () => {
      mockPremium();
      vi.mocked(computeAdaptiveGoals).mockResolvedValue(mockRecommendation as never);
      vi.mocked(storage.createGoalAdjustmentLog).mockResolvedValue({} as never);
      vi.mocked(storage.updateUser).mockResolvedValue({} as never);

      const res = await request(app)
        .post("/api/goals/adaptive/dismiss")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(storage.createGoalAdjustmentLog).toHaveBeenCalledWith(
        expect.objectContaining({ acceptedByUser: false }),
      );
    });

    it("succeeds even with no recommendation", async () => {
      mockPremium();
      vi.mocked(computeAdaptiveGoals).mockResolvedValue(null as never);

      const res = await request(app)
        .post("/api/goals/adaptive/dismiss")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(storage.createGoalAdjustmentLog).not.toHaveBeenCalled();
    });
  });

  describe("PUT /api/goals/adaptive/settings", () => {
    it("enables adaptive goals", async () => {
      mockPremium();
      vi.mocked(storage.updateUser).mockResolvedValue({} as never);

      const res = await request(app)
        .put("/api/goals/adaptive/settings")
        .set("Authorization", "Bearer token")
        .send({ enabled: true });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.enabled).toBe(true);
      expect(storage.updateUser).toHaveBeenCalledWith("1", {
        adaptiveGoalsEnabled: true,
      });
    });

    it("returns 400 for invalid enabled value", async () => {
      mockPremium();

      const res = await request(app)
        .put("/api/goals/adaptive/settings")
        .set("Authorization", "Bearer token")
        .send({ enabled: "yes" });

      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/goals/adjustment-history", () => {
    it("returns adjustment logs", async () => {
      mockPremium();
      const logs = [{ id: 1, reason: "test" }];
      vi.mocked(storage.getGoalAdjustmentLogs).mockResolvedValue(logs as never);

      const res = await request(app)
        .get("/api/goals/adjustment-history")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body).toEqual(logs);
    });

    it("respects limit query param", async () => {
      mockPremium();
      vi.mocked(storage.getGoalAdjustmentLogs).mockResolvedValue([] as never);

      await request(app)
        .get("/api/goals/adjustment-history?limit=10")
        .set("Authorization", "Bearer token");

      expect(storage.getGoalAdjustmentLogs).toHaveBeenCalledWith("1", 10);
    });
  });
});
