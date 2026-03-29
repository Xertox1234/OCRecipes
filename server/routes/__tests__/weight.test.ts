import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { register } from "../weight";
import { createMockWeightLog, createMockUser } from "../../__tests__/factories";

vi.mock("../../storage", () => ({
  storage: {
    getUser: vi.fn(),
    updateUser: vi.fn(),
    getWeightLogs: vi.fn(),
    createWeightLog: vi.fn(),
    createWeightLogAndUpdateUser: vi.fn(),
    deleteWeightLog: vi.fn(),
    getSubscriptionStatus: vi.fn(),
  },
}));

vi.mock("../../middleware/auth");

vi.mock("express-rate-limit");

vi.mock("../../services/weight-trend", () => ({
  calculateWeightTrend: vi.fn().mockReturnValue({
    currentWeight: 75,
    weeklyRateOfChange: -0.3,
    entries: [],
    goalWeight: 70,
    projectedDate: "2024-06-01",
  }),
}));

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

const mockWeightLog = createMockWeightLog({
  weight: "75.5",
  loggedAt: new Date("2024-01-15T12:00:00"),
});

describe("Weight Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    app = createApp();
  });

  describe("GET /api/weight", () => {
    it("returns weight logs", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "premium",
        expiresAt: null,
      });
      vi.mocked(storage.getWeightLogs).mockResolvedValue([mockWeightLog]);

      const res = await request(app)
        .get("/api/weight")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });

    it("limits free users to 7 entries", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue(null);
      vi.mocked(storage.getWeightLogs).mockResolvedValue([]);

      await request(app)
        .get("/api/weight")
        .set("Authorization", "Bearer token");

      expect(storage.getWeightLogs).toHaveBeenCalledWith("1", {
        from: undefined,
        to: undefined,
        limit: 7,
      });
    });
  });

  describe("GET /api/weight/trend", () => {
    it("returns full trend for premium users", async () => {
      vi.mocked(storage.getUser).mockResolvedValue(
        createMockUser({ goalWeight: "70" }),
      );
      vi.mocked(storage.getWeightLogs).mockResolvedValue([]);
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "premium",
        expiresAt: null,
      });

      const res = await request(app)
        .get("/api/weight/trend")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("goalWeight");
    });

    it("returns basic trend for free users", async () => {
      vi.mocked(storage.getUser).mockResolvedValue(
        createMockUser({ goalWeight: "70" }),
      );
      vi.mocked(storage.getWeightLogs).mockResolvedValue([]);
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue(null);

      const res = await request(app)
        .get("/api/weight/trend")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("currentWeight");
      expect(res.body).not.toHaveProperty("goalWeight");
    });

    it("returns 404 if user not found", async () => {
      vi.mocked(storage.getUser).mockResolvedValue(undefined);

      const res = await request(app)
        .get("/api/weight/trend")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/weight", () => {
    it("creates a weight log and updates user weight", async () => {
      vi.mocked(storage.createWeightLogAndUpdateUser).mockResolvedValue(
        mockWeightLog,
      );

      const res = await request(app)
        .post("/api/weight")
        .set("Authorization", "Bearer token")
        .send({ weight: 75.5 });

      expect(res.status).toBe(201);
      expect(storage.createWeightLogAndUpdateUser).toHaveBeenCalledWith({
        userId: "1",
        weight: "75.5",
        source: "manual",
        note: undefined,
      });
    });

    it("returns 400 for negative weight", async () => {
      const res = await request(app)
        .post("/api/weight")
        .set("Authorization", "Bearer token")
        .send({ weight: -5 });

      expect(res.status).toBe(400);
    });

    it("returns 400 for weight above 999", async () => {
      const res = await request(app)
        .post("/api/weight")
        .set("Authorization", "Bearer token")
        .send({ weight: 1000 });

      expect(res.status).toBe(400);
    });

    it("accepts optional source and note", async () => {
      vi.mocked(storage.createWeightLogAndUpdateUser).mockResolvedValue(
        mockWeightLog,
      );

      const res = await request(app)
        .post("/api/weight")
        .set("Authorization", "Bearer token")
        .send({ weight: 80, source: "healthkit", note: "Morning weigh-in" });

      expect(res.status).toBe(201);
    });
  });

  describe("DELETE /api/weight/:id", () => {
    it("deletes a weight log", async () => {
      vi.mocked(storage.deleteWeightLog).mockResolvedValue(true);

      const res = await request(app)
        .delete("/api/weight/1")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(204);
    });

    it("returns 404 for non-existent log", async () => {
      vi.mocked(storage.deleteWeightLog).mockResolvedValue(false);

      const res = await request(app)
        .delete("/api/weight/999")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(404);
    });

    it("returns 400 for invalid ID", async () => {
      const res = await request(app)
        .delete("/api/weight/abc")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
    });
  });

  describe("PUT /api/goals/weight", () => {
    it("sets goal weight", async () => {
      vi.mocked(storage.updateUser).mockResolvedValue(
        createMockUser({ goalWeight: "70" }),
      );

      const res = await request(app)
        .put("/api/goals/weight")
        .set("Authorization", "Bearer token")
        .send({ goalWeight: 70 });

      expect(res.status).toBe(200);
      expect(res.body.goalWeight).toBe("70");
    });

    it("clears goal weight with null", async () => {
      vi.mocked(storage.updateUser).mockResolvedValue(
        createMockUser({ goalWeight: null }),
      );

      const res = await request(app)
        .put("/api/goals/weight")
        .set("Authorization", "Bearer token")
        .send({ goalWeight: null });

      expect(res.status).toBe(200);
    });

    it("returns 400 for invalid weight", async () => {
      const res = await request(app)
        .put("/api/goals/weight")
        .set("Authorization", "Bearer token")
        .send({ goalWeight: -5 });

      expect(res.status).toBe(400);
    });
  });
});
