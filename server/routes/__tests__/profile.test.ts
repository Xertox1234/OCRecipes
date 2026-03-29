import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { register } from "../profile";
import { createMockUserProfile } from "../../__tests__/factories";

vi.mock("../../storage", () => ({
  storage: {
    getUserProfile: vi.fn(),
    updateUserProfile: vi.fn(),
    createUserProfile: vi.fn(),
    upsertProfileWithOnboarding: vi.fn(),
    invalidateSuggestionCacheForUser: vi.fn().mockResolvedValue(undefined),
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

const mockProfile = createMockUserProfile({
  allergies: [{ name: "peanuts", severity: "mild" as const }],
  dietType: "omnivore",
  primaryGoal: "maintain",
  activityLevel: "moderate",
  householdSize: 2,
  cuisinePreferences: ["italian"],
  cookingSkillLevel: "intermediate",
  cookingTimeAvailable: "30min",
});

describe("Profile Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    app = createApp();
  });

  describe("GET /api/user/dietary-profile", () => {
    it("returns dietary profile", async () => {
      vi.mocked(storage.getUserProfile).mockResolvedValue(mockProfile);

      const res = await request(app)
        .get("/api/user/dietary-profile")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.dietType).toBe("omnivore");
      expect(res.body.allergies).toContainEqual({
        name: "peanuts",
        severity: "mild",
      });
    });

    it("returns null if no profile set", async () => {
      vi.mocked(storage.getUserProfile).mockResolvedValue(undefined);

      const res = await request(app)
        .get("/api/user/dietary-profile")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body).toBeNull();
    });
  });

  describe("PUT /api/user/dietary-profile", () => {
    it("updates dietary profile fields", async () => {
      const updated = createMockUserProfile({
        ...mockProfile,
        dietType: "vegetarian",
      });
      vi.mocked(storage.updateUserProfile).mockResolvedValue(updated);

      const res = await request(app)
        .put("/api/user/dietary-profile")
        .set("Authorization", "Bearer token")
        .send({ dietType: "vegetarian" });

      expect(res.status).toBe(200);
      expect(res.body.dietType).toBe("vegetarian");
    });

    it("invalidates suggestion cache when cache-affecting fields change", async () => {
      vi.mocked(storage.updateUserProfile).mockResolvedValue(mockProfile);

      await request(app)
        .put("/api/user/dietary-profile")
        .set("Authorization", "Bearer token")
        .send({ dietType: "keto" });

      // Fire-and-forget — but the call is synchronous
      // Need to wait a tick for the microtask to resolve
      await new Promise((r) => setTimeout(r, 10));
      expect(storage.invalidateSuggestionCacheForUser).toHaveBeenCalledWith(
        "1",
      );
    });

    it("does not invalidate cache for non-affecting fields", async () => {
      vi.mocked(storage.updateUserProfile).mockResolvedValue(mockProfile);

      await request(app)
        .put("/api/user/dietary-profile")
        .set("Authorization", "Bearer token")
        .send({ householdSize: 3 });

      expect(storage.invalidateSuggestionCacheForUser).not.toHaveBeenCalled();
    });

    it("returns 404 if profile not found", async () => {
      vi.mocked(storage.updateUserProfile).mockResolvedValue(undefined);

      const res = await request(app)
        .put("/api/user/dietary-profile")
        .set("Authorization", "Bearer token")
        .send({ dietType: "vegan" });

      expect(res.status).toBe(404);
    });

    it("returns 400 for invalid field values", async () => {
      const res = await request(app)
        .put("/api/user/dietary-profile")
        .set("Authorization", "Bearer token")
        .send({ dietType: 12345 });

      expect(res.status).toBe(400);
    });

    it("returns 500 when storage throws", async () => {
      vi.mocked(storage.updateUserProfile).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .put("/api/user/dietary-profile")
        .set("Authorization", "Bearer token")
        .send({ dietType: "vegan" });

      expect(res.status).toBe(500);
    });
  });

  describe("GET /api/user/dietary-profile (error)", () => {
    it("returns 500 when storage throws", async () => {
      vi.mocked(storage.getUserProfile).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .get("/api/user/dietary-profile")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
    });
  });

  describe("POST /api/user/dietary-profile", () => {
    it("creates profile via transaction and returns 201", async () => {
      vi.mocked(storage.upsertProfileWithOnboarding).mockResolvedValue(
        mockProfile,
      );

      const res = await request(app)
        .post("/api/user/dietary-profile")
        .set("Authorization", "Bearer token")
        .send({
          allergies: [{ name: "peanuts", severity: "mild" }],
          healthConditions: [],
          dietType: "omnivore",
          foodDislikes: [],
          primaryGoal: "maintain",
          activityLevel: "moderate",
          householdSize: 2,
          cuisinePreferences: ["italian"],
          cookingSkillLevel: "intermediate",
          cookingTimeAvailable: "30min",
        });

      expect(res.status).toBe(201);
    });

    it("returns 400 for invalid body", async () => {
      const res = await request(app)
        .post("/api/user/dietary-profile")
        .set("Authorization", "Bearer token")
        .send({ dietType: 12345 });

      expect(res.status).toBe(400);
    });

    it("returns 500 when transaction fails", async () => {
      vi.mocked(storage.upsertProfileWithOnboarding).mockRejectedValue(
        new Error("TX error"),
      );

      const res = await request(app)
        .post("/api/user/dietary-profile")
        .set("Authorization", "Bearer token")
        .send({
          allergies: [],
          healthConditions: [],
          dietType: "omnivore",
          foodDislikes: [],
          primaryGoal: "maintain",
          activityLevel: "moderate",
          householdSize: 1,
          cuisinePreferences: [],
          cookingSkillLevel: "beginner",
          cookingTimeAvailable: "15min",
        });

      expect(res.status).toBe(500);
    });
  });
});
