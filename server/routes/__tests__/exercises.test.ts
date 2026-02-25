import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../../storage", () => ({
  storage: {
    getExerciseDailySummary: vi.fn(),
    getExerciseLogs: vi.fn(),
    createExerciseLog: vi.fn(),
    updateExerciseLog: vi.fn(),
    deleteExerciseLog: vi.fn(),
    searchExerciseLibrary: vi.fn(),
    createExerciseLibraryEntry: vi.fn(),
    getUser: vi.fn(),
    getDailySummary: vi.fn(),
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
import { register } from "../exercises";

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

const mockExerciseLog = {
  id: 1,
  userId: "1",
  exerciseName: "Running",
  exerciseType: "cardio",
  durationMinutes: 30,
  caloriesBurned: 300,
  intensity: "moderate",
  source: "manual",
  notes: null,
  loggedAt: new Date("2024-01-15T12:00:00"),
};

const mockSummary = {
  totalCalories: 300,
  totalDuration: 30,
  exerciseCount: 1,
};

describe("Exercise Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    app = createApp();
  });

  describe("GET /api/exercises/summary", () => {
    it("returns daily exercise summary", async () => {
      vi.mocked(storage.getExerciseDailySummary).mockResolvedValue(mockSummary as never);

      const res = await request(app)
        .get("/api/exercises/summary")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.totalCalories).toBe(300);
    });

    it("accepts date parameter", async () => {
      vi.mocked(storage.getExerciseDailySummary).mockResolvedValue(mockSummary as never);

      await request(app)
        .get("/api/exercises/summary?date=2024-01-15")
        .set("Authorization", "Bearer token");

      expect(storage.getExerciseDailySummary).toHaveBeenCalled();
    });
  });

  describe("GET /api/exercises", () => {
    it("returns exercise logs", async () => {
      vi.mocked(storage.getExerciseLogs).mockResolvedValue([mockExerciseLog] as never);

      const res = await request(app)
        .get("/api/exercises")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].exerciseName).toBe("Running");
    });
  });

  describe("POST /api/exercises", () => {
    it("creates an exercise log", async () => {
      vi.mocked(storage.searchExerciseLibrary).mockResolvedValue([] as never);
      vi.mocked(storage.getUser).mockResolvedValue({ weight: "75" } as never);
      vi.mocked(storage.createExerciseLog).mockResolvedValue(mockExerciseLog as never);

      const res = await request(app)
        .post("/api/exercises")
        .set("Authorization", "Bearer token")
        .send({
          exerciseName: "Running",
          exerciseType: "cardio",
          durationMinutes: 30,
          caloriesBurned: 300,
        });

      expect(res.status).toBe(201);
      expect(res.body.exerciseName).toBe("Running");
    });

    it("returns 400 for missing exercise name", async () => {
      const res = await request(app)
        .post("/api/exercises")
        .set("Authorization", "Bearer token")
        .send({
          exerciseType: "cardio",
          durationMinutes: 30,
        });

      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid exercise type", async () => {
      const res = await request(app)
        .post("/api/exercises")
        .set("Authorization", "Bearer token")
        .send({
          exerciseName: "Running",
          exerciseType: "invalid",
          durationMinutes: 30,
        });

      expect(res.status).toBe(400);
    });

    it("returns 400 for negative duration", async () => {
      const res = await request(app)
        .post("/api/exercises")
        .set("Authorization", "Bearer token")
        .send({
          exerciseName: "Running",
          exerciseType: "cardio",
          durationMinutes: -10,
        });

      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /api/exercises/:id", () => {
    it("deletes an exercise log", async () => {
      vi.mocked(storage.deleteExerciseLog).mockResolvedValue(true as never);

      const res = await request(app)
        .delete("/api/exercises/1")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("returns 404 for non-existent log", async () => {
      vi.mocked(storage.deleteExerciseLog).mockResolvedValue(false as never);

      const res = await request(app)
        .delete("/api/exercises/999")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(404);
    });

    it("returns 400 for invalid ID", async () => {
      const res = await request(app)
        .delete("/api/exercises/abc")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/exercise-library", () => {
    it("searches exercise library", async () => {
      vi.mocked(storage.searchExerciseLibrary).mockResolvedValue([
        { id: 1, name: "Running", type: "cardio", metValue: 8 },
      ] as never);

      const res = await request(app)
        .get("/api/exercise-library?q=run")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });

    it("returns empty array for empty query", async () => {
      const res = await request(app)
        .get("/api/exercise-library?q=")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  describe("POST /api/exercise-library", () => {
    it("creates a library entry", async () => {
      vi.mocked(storage.createExerciseLibraryEntry).mockResolvedValue({
        id: 1,
        name: "Push-ups",
        type: "strength",
        metValue: 3.8,
      } as never);

      const res = await request(app)
        .post("/api/exercise-library")
        .set("Authorization", "Bearer token")
        .send({
          name: "Push-ups",
          type: "strength",
          metValue: 3.8,
        });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe("Push-ups");
    });

    it("returns 400 for missing name", async () => {
      const res = await request(app)
        .post("/api/exercise-library")
        .set("Authorization", "Bearer token")
        .send({ type: "strength", metValue: 3.8 });

      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/daily-budget", () => {
    it("returns daily budget with exercise adjustment", async () => {
      vi.mocked(storage.getUser).mockResolvedValue({
        dailyCalorieGoal: 2000,
      } as never);
      vi.mocked(storage.getDailySummary).mockResolvedValue({
        totalCalories: 800,
      } as never);
      vi.mocked(storage.getExerciseDailySummary).mockResolvedValue({
        totalCalories: 300,
      } as never);

      const res = await request(app)
        .get("/api/daily-budget")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("adjustedBudget");
    });
  });
});
