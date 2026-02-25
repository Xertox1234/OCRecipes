import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../../storage", () => ({
  storage: {
    getUserProfile: vi.fn(),
    updateUserProfile: vi.fn(),
    invalidateSuggestionCacheForUser: vi.fn().mockResolvedValue(undefined),
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

// Mock db for transaction-based endpoints
vi.mock("../../db", () => ({
  db: {
    transaction: vi.fn(),
  },
}));

import { storage } from "../../storage";
import { register } from "../profile";

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

const mockProfile = {
  id: 1,
  userId: "1",
  allergies: ["peanuts"],
  healthConditions: [],
  dietType: "omnivore",
  foodDislikes: [],
  primaryGoal: "maintain",
  activityLevel: "moderate",
  householdSize: 2,
  cuisinePreferences: ["italian"],
  cookingSkillLevel: "intermediate",
  cookingTimeAvailable: "30min",
};

describe("Profile Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    app = createApp();
  });

  describe("GET /api/user/dietary-profile", () => {
    it("returns dietary profile", async () => {
      vi.mocked(storage.getUserProfile).mockResolvedValue(mockProfile as never);

      const res = await request(app)
        .get("/api/user/dietary-profile")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.dietType).toBe("omnivore");
      expect(res.body.allergies).toContain("peanuts");
    });

    it("returns null if no profile set", async () => {
      vi.mocked(storage.getUserProfile).mockResolvedValue(null as never);

      const res = await request(app)
        .get("/api/user/dietary-profile")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body).toBeNull();
    });
  });

  describe("PUT /api/user/dietary-profile", () => {
    it("updates dietary profile fields", async () => {
      const updated = { ...mockProfile, dietType: "vegetarian" };
      vi.mocked(storage.updateUserProfile).mockResolvedValue(updated as never);

      const res = await request(app)
        .put("/api/user/dietary-profile")
        .set("Authorization", "Bearer token")
        .send({ dietType: "vegetarian" });

      expect(res.status).toBe(200);
      expect(res.body.dietType).toBe("vegetarian");
    });

    it("invalidates suggestion cache when cache-affecting fields change", async () => {
      vi.mocked(storage.updateUserProfile).mockResolvedValue(mockProfile as never);

      await request(app)
        .put("/api/user/dietary-profile")
        .set("Authorization", "Bearer token")
        .send({ dietType: "keto" });

      // Fire-and-forget — but the call is synchronous
      // Need to wait a tick for the microtask to resolve
      await new Promise((r) => setTimeout(r, 10));
      expect(storage.invalidateSuggestionCacheForUser).toHaveBeenCalledWith("1");
    });

    it("does not invalidate cache for non-affecting fields", async () => {
      vi.mocked(storage.updateUserProfile).mockResolvedValue(mockProfile as never);

      await request(app)
        .put("/api/user/dietary-profile")
        .set("Authorization", "Bearer token")
        .send({ householdSize: 3 });

      expect(storage.invalidateSuggestionCacheForUser).not.toHaveBeenCalled();
    });

    it("returns 404 if profile not found", async () => {
      vi.mocked(storage.updateUserProfile).mockResolvedValue(null as never);

      const res = await request(app)
        .put("/api/user/dietary-profile")
        .set("Authorization", "Bearer token")
        .send({ dietType: "vegan" });

      expect(res.status).toBe(404);
    });
  });
});
