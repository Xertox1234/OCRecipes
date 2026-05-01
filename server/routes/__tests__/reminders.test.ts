import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { register } from "../reminders";
import { createMockUserProfile } from "../../__tests__/factories";

vi.mock("../../storage", () => ({
  storage: {
    hasPendingReminders: vi.fn(),
    acknowledgeReminders: vi.fn(),
    getUserProfile: vi.fn(),
    updateUserProfile: vi.fn(),
  },
}));

vi.mock("../../middleware/auth");

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

describe("Reminders Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    app = createApp();
    vi.clearAllMocks();
  });

  describe("GET /api/reminders/pending", () => {
    it("returns hasPending: true when storage returns true", async () => {
      vi.mocked(storage.hasPendingReminders).mockResolvedValue(true);

      const res = await request(app)
        .get("/api/reminders/pending")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ hasPending: true });
    });

    it("returns hasPending: false when storage returns false", async () => {
      vi.mocked(storage.hasPendingReminders).mockResolvedValue(false);

      const res = await request(app)
        .get("/api/reminders/pending")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ hasPending: false });
    });
  });

  describe("POST /api/reminders/acknowledge", () => {
    it("returns acknowledged count and coachContext for pending items", async () => {
      const mockContext = [
        { type: "meal-log", mealType: "breakfast", lastLoggedAt: null },
        {
          type: "daily-checkin",
          calories: 1200,
          goal: 2000,
        },
      ];
      vi.mocked(storage.acknowledgeReminders).mockResolvedValue(
        mockContext as ReturnType<
          typeof storage.acknowledgeReminders
        > extends Promise<infer T>
          ? T
          : never,
      );

      const res = await request(app)
        .post("/api/reminders/acknowledge")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.acknowledged).toBe(2);
      expect(res.body.coachContext).toEqual(mockContext);
    });

    it("returns acknowledged: 0 and empty coachContext when nothing pending", async () => {
      vi.mocked(storage.acknowledgeReminders).mockResolvedValue([]);

      const res = await request(app)
        .post("/api/reminders/acknowledge")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ acknowledged: 0, coachContext: [] });
    });
  });

  describe("PATCH /api/reminders/mutes", () => {
    it("merges incoming mutes with existing and saves merged result", async () => {
      const existingProfile = createMockUserProfile({
        reminderMutes: { "meal-log": true },
      });
      vi.mocked(storage.getUserProfile).mockResolvedValue(existingProfile);
      vi.mocked(storage.updateUserProfile).mockResolvedValue(existingProfile);

      const res = await request(app)
        .patch("/api/reminders/mutes")
        .set("Authorization", "Bearer token")
        .send({ commitment: true });

      expect(res.status).toBe(200);
      expect(res.body.reminderMutes).toEqual({
        "meal-log": true,
        commitment: true,
      });
      expect(storage.updateUserProfile).toHaveBeenCalledWith(
        expect.any(String),
        { reminderMutes: { "meal-log": true, commitment: true } },
      );
    });

    it("returns 400 for unknown/invalid keys", async () => {
      const res = await request(app)
        .patch("/api/reminders/mutes")
        .set("Authorization", "Bearer token")
        .send({ unknown: true });

      expect(res.status).toBe(400);
    });
  });
});
