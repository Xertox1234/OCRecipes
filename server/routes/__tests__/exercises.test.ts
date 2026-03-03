import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { calculateCaloriesBurned } from "../../services/exercise-calorie";
import { register } from "../exercises";

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

vi.mock("../../services/exercise-calorie", () => ({
  calculateCaloriesBurned: vi.fn().mockReturnValue(250),
}));

vi.mock("../../middleware/auth");

vi.mock("express-rate-limit");

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
  totalCaloriesBurned: 300,
  totalMinutes: 30,
  exerciseCount: 1,
};

describe("Exercise Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    app = createApp();
  });

  describe("GET /api/exercises/summary", () => {
    it("returns daily exercise summary", async () => {
      vi.mocked(storage.getExerciseDailySummary).mockResolvedValue(
        mockSummary as never,
      );

      const res = await request(app)
        .get("/api/exercises/summary")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.totalCaloriesBurned).toBe(300);
    });

    it("accepts date parameter", async () => {
      vi.mocked(storage.getExerciseDailySummary).mockResolvedValue(
        mockSummary as never,
      );

      await request(app)
        .get("/api/exercises/summary?date=2024-01-15")
        .set("Authorization", "Bearer token");

      expect(storage.getExerciseDailySummary).toHaveBeenCalled();
    });
  });

  describe("GET /api/exercises", () => {
    it("returns exercise logs", async () => {
      vi.mocked(storage.getExerciseLogs).mockResolvedValue([
        mockExerciseLog,
      ] as never);

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
      vi.mocked(storage.createExerciseLog).mockResolvedValue(
        mockExerciseLog as never,
      );

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

      expect(res.status).toBe(204);
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
        { id: 1, name: "Running", type: "cardio", metValue: "8" },
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

  describe("PUT /api/exercises/:id", () => {
    it("updates exercise log fields", async () => {
      vi.mocked(storage.updateExerciseLog).mockResolvedValue({
        ...mockExerciseLog,
        caloriesBurned: "350",
        durationMinutes: 45,
      } as never);

      const res = await request(app)
        .put("/api/exercises/1")
        .set("Authorization", "Bearer token")
        .send({ durationMinutes: 45, caloriesBurned: 350 });

      expect(res.status).toBe(200);
      expect(storage.updateExerciseLog).toHaveBeenCalledWith(1, "1", {
        durationMinutes: 45,
        caloriesBurned: "350",
      });
    });

    it("converts numeric fields to strings", async () => {
      vi.mocked(storage.updateExerciseLog).mockResolvedValue(
        mockExerciseLog as never,
      );

      await request(app)
        .put("/api/exercises/1")
        .set("Authorization", "Bearer token")
        .send({ weightLifted: 100, distanceKm: 5.5 });

      expect(storage.updateExerciseLog).toHaveBeenCalledWith(1, "1", {
        weightLifted: "100",
        distanceKm: "5.5",
      });
    });

    it("returns 400 for invalid ID", async () => {
      const res = await request(app)
        .put("/api/exercises/abc")
        .set("Authorization", "Bearer token")
        .send({ durationMinutes: 45 });

      expect(res.status).toBe(400);
    });

    it("returns 404 when exercise not found", async () => {
      vi.mocked(storage.updateExerciseLog).mockResolvedValue(null as never);

      const res = await request(app)
        .put("/api/exercises/999")
        .set("Authorization", "Bearer token")
        .send({ durationMinutes: 45 });

      expect(res.status).toBe(404);
    });

    it("returns 400 for invalid exercise type", async () => {
      const res = await request(app)
        .put("/api/exercises/1")
        .set("Authorization", "Bearer token")
        .send({ exerciseType: "swimming_laps" });

      expect(res.status).toBe(400);
    });

    it("returns 500 when storage throws", async () => {
      vi.mocked(storage.updateExerciseLog).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .put("/api/exercises/1")
        .set("Authorization", "Bearer token")
        .send({ durationMinutes: 45 });

      expect(res.status).toBe(500);
    });
  });

  describe("POST /api/exercises — auto-calorie calculation", () => {
    it("auto-calculates calories when library match found", async () => {
      vi.mocked(storage.searchExerciseLibrary).mockResolvedValue([
        { id: 1, name: "Running", type: "cardio", metValue: "9.8" },
      ] as never);
      vi.mocked(storage.getUser).mockResolvedValue({ weight: "80" } as never);
      vi.mocked(calculateCaloriesBurned).mockReturnValue(392);
      vi.mocked(storage.createExerciseLog).mockResolvedValue(
        mockExerciseLog as never,
      );

      await request(app)
        .post("/api/exercises")
        .set("Authorization", "Bearer token")
        .send({
          exerciseName: "Running",
          exerciseType: "cardio",
          durationMinutes: 30,
        });

      expect(calculateCaloriesBurned).toHaveBeenCalledWith(9.8, 80, 30);
      expect(storage.createExerciseLog).toHaveBeenCalledWith(
        expect.objectContaining({ caloriesBurned: "392" }),
      );
    });

    it("leaves calories undefined when no library match", async () => {
      vi.mocked(storage.searchExerciseLibrary).mockResolvedValue([
        { id: 1, name: "Jogging", type: "cardio", metValue: "7" },
      ] as never);
      vi.mocked(storage.createExerciseLog).mockResolvedValue(
        mockExerciseLog as never,
      );

      await request(app)
        .post("/api/exercises")
        .set("Authorization", "Bearer token")
        .send({
          exerciseName: "Running",
          exerciseType: "cardio",
          durationMinutes: 30,
        });

      expect(storage.createExerciseLog).toHaveBeenCalledWith(
        expect.objectContaining({ caloriesBurned: undefined }),
      );
    });

    it("defaults to 70kg when user has no weight", async () => {
      vi.mocked(storage.searchExerciseLibrary).mockResolvedValue([
        { id: 1, name: "Running", type: "cardio", metValue: "9.8" },
      ] as never);
      vi.mocked(storage.getUser).mockResolvedValue({
        weight: null,
      } as never);
      vi.mocked(calculateCaloriesBurned).mockReturnValue(343);
      vi.mocked(storage.createExerciseLog).mockResolvedValue(
        mockExerciseLog as never,
      );

      await request(app)
        .post("/api/exercises")
        .set("Authorization", "Bearer token")
        .send({
          exerciseName: "Running",
          exerciseType: "cardio",
          durationMinutes: 30,
        });

      expect(calculateCaloriesBurned).toHaveBeenCalledWith(9.8, 70, 30);
    });

    it("returns 500 when storage throws on create", async () => {
      vi.mocked(storage.searchExerciseLibrary).mockResolvedValue([] as never);
      vi.mocked(storage.createExerciseLog).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .post("/api/exercises")
        .set("Authorization", "Bearer token")
        .send({
          exerciseName: "Running",
          exerciseType: "cardio",
          durationMinutes: 30,
        });

      expect(res.status).toBe(500);
    });
  });

  describe("GET /api/exercises — query params", () => {
    it("passes from and to dates to storage", async () => {
      vi.mocked(storage.getExerciseLogs).mockResolvedValue([] as never);

      await request(app)
        .get("/api/exercises?from=2024-01-01&to=2024-01-31")
        .set("Authorization", "Bearer token");

      expect(storage.getExerciseLogs).toHaveBeenCalledWith("1", {
        from: expect.any(Date),
        to: expect.any(Date),
        limit: undefined,
      });
    });

    it("caps limit at 100", async () => {
      vi.mocked(storage.getExerciseLogs).mockResolvedValue([] as never);

      await request(app)
        .get("/api/exercises?limit=500")
        .set("Authorization", "Bearer token");

      expect(storage.getExerciseLogs).toHaveBeenCalledWith("1", {
        from: undefined,
        to: undefined,
        limit: 100,
      });
    });

    it("returns 500 when storage throws", async () => {
      vi.mocked(storage.getExerciseLogs).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .get("/api/exercises")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
    });
  });

  describe("Error paths", () => {
    it("GET /api/exercises/summary returns 500 on storage error", async () => {
      vi.mocked(storage.getExerciseDailySummary).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .get("/api/exercises/summary")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
    });

    it("DELETE /api/exercises/:id returns 500 on storage error", async () => {
      vi.mocked(storage.deleteExerciseLog).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .delete("/api/exercises/1")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
    });

    it("GET /api/exercise-library returns 500 on storage error", async () => {
      vi.mocked(storage.searchExerciseLibrary).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .get("/api/exercise-library?q=run")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
    });

    it("POST /api/exercise-library returns 500 on storage error", async () => {
      vi.mocked(storage.createExerciseLibraryEntry).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .post("/api/exercise-library")
        .set("Authorization", "Bearer token")
        .send({ name: "Push-ups", type: "strength", metValue: 3.8 });

      expect(res.status).toBe(500);
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
        totalCaloriesBurned: 300,
        totalMinutes: 30,
        exerciseCount: 1,
      } as never);

      const res = await request(app)
        .get("/api/daily-budget")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.adjustedBudget).toBe(2300);
      expect(res.body.remaining).toBe(1500);
      expect(res.body.exerciseCalories).toBe(300);
    });

    it("returns 404 when user not found", async () => {
      vi.mocked(storage.getUser).mockResolvedValue(null as never);

      const res = await request(app)
        .get("/api/daily-budget")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(404);
    });

    it("returns 500 when storage throws", async () => {
      vi.mocked(storage.getUser).mockRejectedValue(new Error("DB error"));

      const res = await request(app)
        .get("/api/daily-budget")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
    });

    it("uses default calorie goal when user has no goal set", async () => {
      vi.mocked(storage.getUser).mockResolvedValue({
        dailyCalorieGoal: null,
      } as never);
      vi.mocked(storage.getDailySummary).mockResolvedValue({
        totalCalories: 500,
      } as never);
      vi.mocked(storage.getExerciseDailySummary).mockResolvedValue({
        totalCaloriesBurned: 200,
        totalMinutes: 20,
        exerciseCount: 1,
      } as never);

      const res = await request(app)
        .get("/api/daily-budget")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.calorieGoal).toBe(2000);
      expect(res.body.adjustedBudget).toBe(2200);
      expect(res.body.remaining).toBe(1700);
    });
  });
});
