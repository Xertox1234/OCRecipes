import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { register } from "../fasting";
import {
  createMockFastingSchedule,
  createMockFastingLog,
} from "../../__tests__/factories";

vi.mock("../../storage", () => ({
  storage: {
    getFastingSchedule: vi.fn(),
    upsertFastingSchedule: vi.fn(),
    getActiveFastingLog: vi.fn(),
    createFastingLog: vi.fn(),
    endFastingLog: vi.fn(),
    getFastingLogs: vi.fn(),
  },
}));

vi.mock("../../middleware/auth");

vi.mock("express-rate-limit");

vi.mock("../../services/fasting-stats", () => ({
  calculateFastingStats: vi.fn().mockReturnValue({
    totalFasts: 5,
    completedFasts: 4,
    averageDurationHours: 16.5,
    longestStreakDays: 3,
    currentStreakDays: 1,
  }),
}));

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

const mockSchedule = createMockFastingSchedule();

const mockFastingLog = createMockFastingLog({
  startedAt: new Date("2024-01-15T20:00:00"),
  completed: false,
});

describe("Fasting Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    app = createApp();
  });

  describe("GET /api/fasting/schedule", () => {
    it("returns fasting schedule", async () => {
      vi.mocked(storage.getFastingSchedule).mockResolvedValue(mockSchedule);

      const res = await request(app)
        .get("/api/fasting/schedule")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.protocol).toBe("16:8");
      expect(res.body.fastingHours).toBe(16);
    });

    it("returns null if no schedule set", async () => {
      vi.mocked(storage.getFastingSchedule).mockResolvedValue(undefined);

      const res = await request(app)
        .get("/api/fasting/schedule")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body).toBeNull();
    });
  });

  describe("PUT /api/fasting/schedule", () => {
    it("creates/updates fasting schedule", async () => {
      vi.mocked(storage.upsertFastingSchedule).mockResolvedValue(mockSchedule);

      const res = await request(app)
        .put("/api/fasting/schedule")
        .set("Authorization", "Bearer token")
        .send({
          protocol: "16:8",
          fastingHours: 16,
          eatingHours: 8,
          eatingWindowStart: "12:00",
          eatingWindowEnd: "20:00",
        });

      expect(res.status).toBe(200);
      expect(res.body.protocol).toBe("16:8");
    });

    it("returns 400 for invalid protocol", async () => {
      const res = await request(app)
        .put("/api/fasting/schedule")
        .set("Authorization", "Bearer token")
        .send({
          protocol: "invalid",
          fastingHours: 16,
          eatingHours: 8,
        });

      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid fasting hours", async () => {
      const res = await request(app)
        .put("/api/fasting/schedule")
        .set("Authorization", "Bearer token")
        .send({
          protocol: "16:8",
          fastingHours: 25,
          eatingHours: 8,
        });

      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/fasting/start", () => {
    it("starts a new fast", async () => {
      vi.mocked(storage.getActiveFastingLog).mockResolvedValue(undefined);
      vi.mocked(storage.getFastingSchedule).mockResolvedValue(mockSchedule);
      vi.mocked(storage.createFastingLog).mockResolvedValue(mockFastingLog);

      const res = await request(app)
        .post("/api/fasting/start")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(201);
      expect(storage.createFastingLog).toHaveBeenCalledWith({
        userId: "1",
        targetDurationHours: 16,
      });
    });

    it("returns 409 if a fast is already active", async () => {
      vi.mocked(storage.getActiveFastingLog).mockResolvedValue(mockFastingLog);

      const res = await request(app)
        .post("/api/fasting/start")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(409);
      expect(res.body.error).toBe("A fast is already in progress");
    });

    it("defaults to 16 hours if no schedule", async () => {
      vi.mocked(storage.getActiveFastingLog).mockResolvedValue(undefined);
      vi.mocked(storage.getFastingSchedule).mockResolvedValue(undefined);
      vi.mocked(storage.createFastingLog).mockResolvedValue(mockFastingLog);

      await request(app)
        .post("/api/fasting/start")
        .set("Authorization", "Bearer token");

      expect(storage.createFastingLog).toHaveBeenCalledWith({
        userId: "1",
        targetDurationHours: 16,
      });
    });
  });

  describe("POST /api/fasting/end", () => {
    it("ends an active fast", async () => {
      const activeFast = createMockFastingLog({
        startedAt: new Date(Date.now() - 17 * 60 * 60000), // 17 hours ago
      });
      vi.mocked(storage.getActiveFastingLog).mockResolvedValue(activeFast);
      vi.mocked(storage.endFastingLog).mockResolvedValue(
        createMockFastingLog({
          ...activeFast,
          completed: true,
        }),
      );

      const res = await request(app)
        .post("/api/fasting/end")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(storage.endFastingLog).toHaveBeenCalled();
    });

    it("returns 404 if no active fast", async () => {
      vi.mocked(storage.getActiveFastingLog).mockResolvedValue(undefined);

      const res = await request(app)
        .post("/api/fasting/end")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("No active fast found");
    });

    it("accepts optional note", async () => {
      const activeFast = createMockFastingLog({
        startedAt: new Date(Date.now() - 8 * 60 * 60000),
      });
      vi.mocked(storage.getActiveFastingLog).mockResolvedValue(activeFast);
      vi.mocked(storage.endFastingLog).mockResolvedValue(activeFast);

      const res = await request(app)
        .post("/api/fasting/end")
        .set("Authorization", "Bearer token")
        .send({ note: "Felt great today!" });

      expect(res.status).toBe(200);
      const endCall = vi.mocked(storage.endFastingLog).mock.calls[0];
      expect(endCall[5]).toBe("Felt great today!");
    });
  });

  describe("GET /api/fasting/current", () => {
    it("returns active fast", async () => {
      vi.mocked(storage.getActiveFastingLog).mockResolvedValue(mockFastingLog);

      const res = await request(app)
        .get("/api/fasting/current")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.targetDurationHours).toBe(16);
    });

    it("returns null if no active fast", async () => {
      vi.mocked(storage.getActiveFastingLog).mockResolvedValue(undefined);

      const res = await request(app)
        .get("/api/fasting/current")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body).toBeNull();
    });

    it("returns 500 on storage error", async () => {
      vi.mocked(storage.getActiveFastingLog).mockRejectedValue(
        new Error("db error"),
      );

      const res = await request(app)
        .get("/api/fasting/current")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Failed to get current fast");
    });
  });

  describe("GET /api/fasting/history", () => {
    it("returns logs and stats", async () => {
      const completedLog = createMockFastingLog({
        endedAt: new Date("2024-01-16T12:00:00"),
        actualDurationMinutes: 960,
        completed: true,
      });
      vi.mocked(storage.getFastingLogs).mockResolvedValue([completedLog]);

      const res = await request(app)
        .get("/api/fasting/history")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.logs).toHaveLength(1);
      expect(res.body.stats).toHaveProperty("totalFasts");
      expect(res.body.stats).toHaveProperty("completedFasts");
    });

    it("respects limit parameter", async () => {
      vi.mocked(storage.getFastingLogs).mockResolvedValue([]);

      await request(app)
        .get("/api/fasting/history?limit=10")
        .set("Authorization", "Bearer token");

      expect(storage.getFastingLogs).toHaveBeenCalledWith("1", 10);
    });

    it("returns 500 on storage error", async () => {
      vi.mocked(storage.getFastingLogs).mockRejectedValue(
        new Error("db error"),
      );

      const res = await request(app)
        .get("/api/fasting/history")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Failed to get fasting history");
    });
  });
});
