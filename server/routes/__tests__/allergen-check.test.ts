import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { register } from "../allergen-check";
import { createMockUserProfile } from "../../__tests__/factories";

vi.mock("../../storage", () => ({
  storage: {
    getUserProfile: vi.fn(),
    getSubscriptionStatus: vi.fn(),
  },
}));

vi.mock("../../middleware/auth");

vi.mock("express-rate-limit");

// Mock the substitution service (it calls OpenAI internally)
vi.mock("../../services/ingredient-substitution", () => ({
  getSubstitutions: vi.fn().mockResolvedValue({
    suggestions: [],
    dietaryProfileSummary: "Allergies: peanuts",
  }),
}));

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

const profileWithAllergies = createMockUserProfile({
  allergies: [
    { name: "peanuts", severity: "severe" },
    { name: "milk", severity: "mild" },
  ],
  dietType: "omnivore",
  primaryGoal: "maintain",
  activityLevel: "moderate",
  cookingSkillLevel: "intermediate",
  cookingTimeAvailable: "30min",
});

const profileNoAllergies = createMockUserProfile({
  allergies: [],
  dietType: "omnivore",
  primaryGoal: "maintain",
  activityLevel: "moderate",
  cookingSkillLevel: "intermediate",
  cookingTimeAvailable: "30min",
});

describe("Allergen Check Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    app = createApp();
    vi.clearAllMocks();
  });

  describe("POST /api/allergen-check", () => {
    it("returns 400 for missing ingredients", async () => {
      const res = await request(app)
        .post("/api/allergen-check")
        .set("Authorization", "Bearer token")
        .send({});

      expect(res.status).toBe(400);
    });

    it("returns 400 for empty ingredients array", async () => {
      const res = await request(app)
        .post("/api/allergen-check")
        .set("Authorization", "Bearer token")
        .send({ ingredients: [] });

      expect(res.status).toBe(400);
    });

    it("returns empty matches when user has no allergies", async () => {
      vi.mocked(storage.getUserProfile).mockResolvedValue(profileNoAllergies);

      const res = await request(app)
        .post("/api/allergen-check")
        .set("Authorization", "Bearer token")
        .send({ ingredients: ["peanut butter", "milk"] });

      expect(res.status).toBe(200);
      expect(res.body.matches).toEqual([]);
      expect(res.body.substitutions).toEqual([]);
    });

    it("detects allergens in ingredients", async () => {
      vi.mocked(storage.getUserProfile).mockResolvedValue(profileWithAllergies);

      const res = await request(app)
        .post("/api/allergen-check")
        .set("Authorization", "Bearer token")
        .send({ ingredients: ["peanut butter", "rice", "whole milk"] });

      expect(res.status).toBe(200);
      expect(res.body.matches.length).toBeGreaterThanOrEqual(2);

      const allergenIds = res.body.matches.map(
        (m: { allergenId: string }) => m.allergenId,
      );
      expect(allergenIds).toContain("peanuts");
      expect(allergenIds).toContain("milk");
    });

    it("does not flag safe ingredients", async () => {
      vi.mocked(storage.getUserProfile).mockResolvedValue(profileWithAllergies);

      const res = await request(app)
        .post("/api/allergen-check")
        .set("Authorization", "Bearer token")
        .send({ ingredients: ["chicken breast", "broccoli", "olive oil"] });

      expect(res.status).toBe(200);
      expect(res.body.matches).toEqual([]);
    });

    it("handles null user profile gracefully", async () => {
      vi.mocked(storage.getUserProfile).mockResolvedValue(undefined);

      const res = await request(app)
        .post("/api/allergen-check")
        .set("Authorization", "Bearer token")
        .send({ ingredients: ["peanut butter"] });

      expect(res.status).toBe(200);
      expect(res.body.matches).toEqual([]);
    });

    it("respects severity for derived ingredients", async () => {
      vi.mocked(storage.getUserProfile).mockResolvedValue(
        createMockUserProfile({
          allergies: [{ name: "milk", severity: "mild" }],
        }),
      );

      const res = await request(app)
        .post("/api/allergen-check")
        .set("Authorization", "Bearer token")
        .send({ ingredients: ["whey protein", "whole milk"] });

      expect(res.status).toBe(200);
      // Mild severity: "whole milk" matches direct "milk", but "whey protein" is derived
      const names = res.body.matches.map(
        (m: { ingredientName: string }) => m.ingredientName,
      );
      expect(names).toContain("whole milk");
      expect(names).not.toContain("whey protein");
    });

    it("moderate severity flags derived ingredients", async () => {
      vi.mocked(storage.getUserProfile).mockResolvedValue(
        createMockUserProfile({
          allergies: [{ name: "milk", severity: "moderate" }],
        }),
      );

      const res = await request(app)
        .post("/api/allergen-check")
        .set("Authorization", "Bearer token")
        .send({ ingredients: ["whey protein", "whole milk"] });

      expect(res.status).toBe(200);
      const names = res.body.matches.map(
        (m: { ingredientName: string }) => m.ingredientName,
      );
      expect(names).toContain("whole milk");
      expect(names).toContain("whey protein");
    });

    it("returns 500 when storage throws", async () => {
      vi.mocked(storage.getUserProfile).mockRejectedValue(
        new Error("DB connection lost"),
      );

      const res = await request(app)
        .post("/api/allergen-check")
        .set("Authorization", "Bearer token")
        .send({ ingredients: ["peanut butter"] });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Failed to check allergens");
    });
  });
});
