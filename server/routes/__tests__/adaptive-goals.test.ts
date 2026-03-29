import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import {
  computeAdaptiveGoals,
  type AdaptiveGoalRecommendation,
} from "../../services/adaptive-goals";
import { register } from "../adaptive-goals";
import {
  createMockUser,
  createMockGoalAdjustmentLog,
} from "../../__tests__/factories";

vi.mock("../../storage", () => ({
  storage: {
    getSubscriptionStatus: vi.fn(),
    getUser: vi.fn(),
    updateUser: vi.fn(),
    createGoalAdjustmentLog: vi.fn(),
    applyAdaptiveGoalsAtomically: vi.fn(),
    dismissAdaptiveGoalsAtomically: vi.fn(),
    getGoalAdjustmentLogs: vi.fn(),
  },
}));

vi.mock("../../services/adaptive-goals", () => ({
  computeAdaptiveGoals: vi.fn(),
}));

vi.mock("../../middleware/auth");

vi.mock("express-rate-limit");

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

function mockPremium() {
  vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
    tier: "premium",
    expiresAt: null,
  });
}

const mockRecommendation: AdaptiveGoalRecommendation = {
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
  explanation: "Weight trending down, increasing calories to compensate",
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
      vi.mocked(storage.getUser).mockResolvedValue(
        createMockUser({ adaptiveGoalsEnabled: true }),
      );
      vi.mocked(computeAdaptiveGoals).mockResolvedValue(mockRecommendation);

      const res = await request(app)
        .get("/api/goals/adaptive")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(true);
      expect(res.body.hasRecommendation).toBe(true);
      expect(res.body.recommendation).toBeDefined();
    });

    it("returns 403 for free tier", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue(undefined);

      const res = await request(app)
        .get("/api/goals/adaptive")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("PREMIUM_REQUIRED");
    });

    it("returns no recommendation when null", async () => {
      mockPremium();
      vi.mocked(storage.getUser).mockResolvedValue(
        createMockUser({ adaptiveGoalsEnabled: false }),
      );
      vi.mocked(computeAdaptiveGoals).mockResolvedValue(null);

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
      vi.mocked(computeAdaptiveGoals).mockResolvedValue(mockRecommendation);
      vi.mocked(storage.applyAdaptiveGoalsAtomically).mockResolvedValue(
        createMockGoalAdjustmentLog(),
      );

      const res = await request(app)
        .post("/api/goals/adaptive/accept")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.appliedGoals.calories).toBe(2200);
      expect(storage.applyAdaptiveGoalsAtomically).toHaveBeenCalledWith(
        "1",
        expect.objectContaining({
          dailyCalorieGoal: 2200,
          dailyProteinGoal: 120,
        }),
        expect.objectContaining({ acceptedByUser: true }),
      );
    });

    it("returns 400 when no recommendation", async () => {
      mockPremium();
      vi.mocked(computeAdaptiveGoals).mockResolvedValue(null);

      const res = await request(app)
        .post("/api/goals/adaptive/accept")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/goals/adaptive/dismiss", () => {
    it("logs dismissed adjustment", async () => {
      mockPremium();
      vi.mocked(computeAdaptiveGoals).mockResolvedValue(mockRecommendation);
      vi.mocked(storage.dismissAdaptiveGoalsAtomically).mockResolvedValue(
        undefined,
      );

      const res = await request(app)
        .post("/api/goals/adaptive/dismiss")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(storage.dismissAdaptiveGoalsAtomically).toHaveBeenCalledWith(
        "1",
        expect.objectContaining({ acceptedByUser: false }),
      );
    });

    it("succeeds even with no recommendation", async () => {
      mockPremium();
      vi.mocked(computeAdaptiveGoals).mockResolvedValue(null);

      const res = await request(app)
        .post("/api/goals/adaptive/dismiss")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(storage.dismissAdaptiveGoalsAtomically).not.toHaveBeenCalled();
    });
  });

  describe("PUT /api/goals/adaptive/settings", () => {
    it("enables adaptive goals", async () => {
      mockPremium();
      vi.mocked(storage.updateUser).mockResolvedValue(createMockUser());

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

    it("returns 500 when storage throws", async () => {
      mockPremium();
      vi.mocked(storage.updateUser).mockRejectedValue(new Error("db error"));

      const res = await request(app)
        .put("/api/goals/adaptive/settings")
        .set("Authorization", "Bearer token")
        .send({ enabled: true });

      expect(res.status).toBe(500);
      expect(res.body.code).toBe("INTERNAL_ERROR");
    });
  });

  describe("GET /api/goals/adjustment-history", () => {
    it("returns adjustment logs", async () => {
      mockPremium();
      const logs = [createMockGoalAdjustmentLog({ reason: "test" })];
      const jsonLogs = JSON.parse(JSON.stringify(logs));
      vi.mocked(storage.getGoalAdjustmentLogs).mockResolvedValue(logs);

      const res = await request(app)
        .get("/api/goals/adjustment-history")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body).toEqual(jsonLogs);
    });

    it("respects limit query param", async () => {
      mockPremium();
      vi.mocked(storage.getGoalAdjustmentLogs).mockResolvedValue([]);

      await request(app)
        .get("/api/goals/adjustment-history?limit=10")
        .set("Authorization", "Bearer token");

      expect(storage.getGoalAdjustmentLogs).toHaveBeenCalledWith("1", 10);
    });

    it("returns 500 when storage throws", async () => {
      mockPremium();
      vi.mocked(storage.getGoalAdjustmentLogs).mockRejectedValue(
        new Error("db error"),
      );

      const res = await request(app)
        .get("/api/goals/adjustment-history")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
      expect(res.body.code).toBe("INTERNAL_ERROR");
    });
  });
});
