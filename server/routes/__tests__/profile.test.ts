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
    withdrawHealthConsent: vi.fn(),
    invalidateSuggestionCacheForUser: vi.fn().mockResolvedValue(undefined),
  },
}));

// Capture floating fire-and-forget promises so tests can deterministically
// await them rather than relying on microtask timing. See
// docs/legacy-patterns/testing.md → "fireAndForget in tests".
let lastFireAndForgetPromise: Promise<unknown> | null = null;
vi.mock("../../lib/fire-and-forget", () => ({
  fireAndForget: (_label: string, promise: Promise<unknown>) => {
    lastFireAndForgetPromise = promise;
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

const consentedProfile = createMockUserProfile({
  healthDataConsentAt: new Date("2026-11-01T00:00:00Z"),
});
const unconsentedProfile = createMockUserProfile({ healthDataConsentAt: null });

describe("Profile Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    app = createApp();
    lastFireAndForgetPromise = null;
    // Default: the stored profile already carries consent, so the health-data
    // gate is open. The consent-gate suite below overrides this.
    vi.mocked(storage.getUserProfile).mockResolvedValue(consentedProfile);
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

      // Deterministically await the captured fire-and-forget promise rather
      // than racing a wall-clock or microtask tick.
      expect(lastFireAndForgetPromise).not.toBeNull();
      await lastFireAndForgetPromise;
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

    describe("health data consent", () => {
      it("forwards recordConsent=true to storage when healthDataConsent is true", async () => {
        vi.mocked(storage.upsertProfileWithOnboarding).mockResolvedValue(
          mockProfile,
        );

        await request(app)
          .post("/api/user/dietary-profile")
          .set("Authorization", "Bearer token")
          .send({
            allergies: [],
            healthConditions: [],
            dietType: null,
            foodDislikes: [],
            primaryGoal: null,
            activityLevel: null,
            householdSize: 1,
            cuisinePreferences: [],
            cookingSkillLevel: null,
            cookingTimeAvailable: null,
            healthDataConsent: true,
          });

        const [, profileData, recordConsent] = vi.mocked(
          storage.upsertProfileWithOnboarding,
        ).mock.calls[0];
        expect(recordConsent).toBe(true);
        // Timestamp is generated inside storage, never passed through the route.
        expect(
          (profileData as Record<string, unknown>).healthDataConsentAt,
        ).toBeUndefined();
      });

      it("forwards recordConsent=false when healthDataConsent is false", async () => {
        vi.mocked(storage.upsertProfileWithOnboarding).mockResolvedValue(
          mockProfile,
        );

        await request(app)
          .post("/api/user/dietary-profile")
          .set("Authorization", "Bearer token")
          .send({
            allergies: [],
            healthConditions: [],
            dietType: null,
            foodDislikes: [],
            primaryGoal: null,
            activityLevel: null,
            householdSize: 1,
            cuisinePreferences: [],
            cookingSkillLevel: null,
            cookingTimeAvailable: null,
            healthDataConsent: false,
          });

        const [, profileData, recordConsent] = vi.mocked(
          storage.upsertProfileWithOnboarding,
        ).mock.calls[0];
        expect(recordConsent).toBe(false);
        expect(
          (profileData as Record<string, unknown>).healthDataConsentAt,
        ).toBeUndefined();
      });

      it("forwards recordConsent=false when consent flag is absent", async () => {
        vi.mocked(storage.upsertProfileWithOnboarding).mockResolvedValue(
          mockProfile,
        );

        await request(app)
          .post("/api/user/dietary-profile")
          .set("Authorization", "Bearer token")
          .send({
            allergies: [],
            healthConditions: [],
            dietType: null,
            foodDislikes: [],
            primaryGoal: null,
            activityLevel: null,
            householdSize: 1,
            cuisinePreferences: [],
            cookingSkillLevel: null,
            cookingTimeAvailable: null,
          });

        const [, profileData, recordConsent] = vi.mocked(
          storage.upsertProfileWithOnboarding,
        ).mock.calls[0];
        expect(recordConsent).toBe(false);
        expect(
          (profileData as Record<string, unknown>).healthDataConsentAt,
        ).toBeUndefined();
      });

      it("ignores client-supplied healthDataConsentAt — only the server stamps the timestamp", async () => {
        vi.mocked(storage.upsertProfileWithOnboarding).mockResolvedValue(
          mockProfile,
        );
        const clientBackdate = "1970-01-01T00:00:00.000Z";

        await request(app)
          .post("/api/user/dietary-profile")
          .set("Authorization", "Bearer token")
          .send({
            allergies: [],
            healthConditions: [],
            dietType: null,
            foodDislikes: [],
            primaryGoal: null,
            activityLevel: null,
            householdSize: 1,
            cuisinePreferences: [],
            cookingSkillLevel: null,
            cookingTimeAvailable: null,
            healthDataConsentAt: clientBackdate,
            healthDataConsent: false,
          });

        const [, profileData, recordConsent] = vi.mocked(
          storage.upsertProfileWithOnboarding,
        ).mock.calls[0];
        // Client value silently dropped (schema omits the field); the
        // storage layer never receives a caller-supplied timestamp.
        expect(recordConsent).toBe(false);
        expect(
          (profileData as Record<string, unknown>).healthDataConsentAt,
        ).toBeUndefined();
      });
    });
  });

  describe("PUT /api/user/dietary-profile health data consent", () => {
    it("forwards recordConsent=true to storage when consent flag is true", async () => {
      vi.mocked(storage.updateUserProfile).mockResolvedValue(mockProfile);

      await request(app)
        .put("/api/user/dietary-profile")
        .set("Authorization", "Bearer token")
        .send({ healthDataConsent: true });

      const [, updates, recordConsent] = vi.mocked(storage.updateUserProfile)
        .mock.calls[0];
      expect(recordConsent).toBe(true);
      // Timestamp is generated inside storage, never passed through the route.
      expect(
        "healthDataConsentAt" in (updates as Record<string, unknown>),
      ).toBe(false);
      // Transient intent flag must not be passed to storage as a column.
      expect("healthDataConsent" in (updates as Record<string, unknown>)).toBe(
        false,
      );
    });

    it("forwards recordConsent=false when consent flag is absent", async () => {
      vi.mocked(storage.updateUserProfile).mockResolvedValue(mockProfile);

      await request(app)
        .put("/api/user/dietary-profile")
        .set("Authorization", "Bearer token")
        .send({ dietType: "vegan" });

      const [, updates, recordConsent] = vi.mocked(storage.updateUserProfile)
        .mock.calls[0];
      expect(recordConsent).toBe(false);
      expect(
        "healthDataConsentAt" in (updates as Record<string, unknown>),
      ).toBe(false);
    });
  });

  describe("health-data consent gate (no consent, no health data)", () => {
    const healthBody = {
      allergies: [{ name: "peanuts", severity: "severe" }],
      healthConditions: ["type 2 diabetes"],
      primaryGoal: "lose_weight",
    };

    beforeEach(() => {
      vi.mocked(storage.upsertProfileWithOnboarding).mockReset();
      vi.mocked(storage.updateUserProfile).mockReset();
      vi.mocked(storage.withdrawHealthConsent).mockReset();
      vi.mocked(storage.getUserProfile).mockResolvedValue(unconsentedProfile);
    });

    it("POST refuses health fields from a user who has not consented", async () => {
      const res = await request(app)
        .post("/api/user/dietary-profile")
        .set("Authorization", "Bearer token")
        .send(healthBody);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("HEALTH_CONSENT_REQUIRED");
      expect(storage.upsertProfileWithOnboarding).not.toHaveBeenCalled();
    });

    it("POST refuses health fields when the user has no profile row yet", async () => {
      vi.mocked(storage.getUserProfile).mockResolvedValue(undefined);

      const res = await request(app)
        .post("/api/user/dietary-profile")
        .set("Authorization", "Bearer token")
        .send(healthBody);

      expect(res.status).toBe(403);
      expect(storage.upsertProfileWithOnboarding).not.toHaveBeenCalled();
    });

    it("POST saves health fields when the same request carries the consent", async () => {
      vi.mocked(storage.upsertProfileWithOnboarding).mockResolvedValue(
        consentedProfile,
      );

      const res = await request(app)
        .post("/api/user/dietary-profile")
        .set("Authorization", "Bearer token")
        .send({ ...healthBody, healthDataConsent: true });

      expect(res.status).toBe(201);
      expect(
        vi.mocked(storage.upsertProfileWithOnboarding).mock.calls[0][2],
      ).toBe(true);
    });

    it("POST saves preferences without consent (the onboarding skip path)", async () => {
      vi.mocked(storage.upsertProfileWithOnboarding).mockResolvedValue(
        unconsentedProfile,
      );

      const res = await request(app)
        .post("/api/user/dietary-profile")
        .set("Authorization", "Bearer token")
        .send({
          allergies: [],
          healthConditions: [],
          primaryGoal: null,
          activityLevel: null,
          dietType: "vegan",
          foodDislikes: ["olives"],
          healthDataConsent: false,
        });

      expect(res.status).toBe(201);
    });

    it("PUT refuses health fields from a user who has not consented", async () => {
      const res = await request(app)
        .put("/api/user/dietary-profile")
        .set("Authorization", "Bearer token")
        .send({ allergies: [{ name: "milk", severity: "mild" }] });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("HEALTH_CONSENT_REQUIRED");
      expect(storage.updateUserProfile).not.toHaveBeenCalled();
    });

    it("PUT saves health fields when the same request carries the consent", async () => {
      vi.mocked(storage.updateUserProfile).mockResolvedValue(consentedProfile);

      const res = await request(app)
        .put("/api/user/dietary-profile")
        .set("Authorization", "Bearer token")
        .send({
          allergies: [{ name: "milk", severity: "mild" }],
          healthDataConsent: true,
        });

      expect(res.status).toBe(200);
      expect(vi.mocked(storage.updateUserProfile).mock.calls[0][2]).toBe(true);
    });

    it("PUT never forwards client-supplied consent-record or mood columns", async () => {
      vi.mocked(storage.updateUserProfile).mockResolvedValue(
        unconsentedProfile,
      );

      const res = await request(app)
        .put("/api/user/dietary-profile")
        .set("Authorization", "Bearer token")
        .send({
          dietType: "vegan",
          healthDataConsentVersion: "1999-01-01",
          healthDataConsentWithdrawnAt: "1999-01-01T00:00:00Z",
          healthDataConsentHistory: [{ event: "granted", at: "1999-01-01" }],
          moodScore: 1,
          moodUpdatedAt: "1999-01-01T00:00:00Z",
        });

      expect(res.status).toBe(200);
      expect(vi.mocked(storage.updateUserProfile).mock.calls[0][1]).toEqual({
        dietType: "vegan",
      });
    });

    it("PUT saves preferences and cleared health fields without consent", async () => {
      vi.mocked(storage.updateUserProfile).mockResolvedValue(
        unconsentedProfile,
      );

      const res = await request(app)
        .put("/api/user/dietary-profile")
        .set("Authorization", "Bearer token")
        .send({ dietType: "vegan", allergies: [] });

      expect(res.status).toBe(200);
    });
  });

  describe("POST /api/user/health-consent/withdraw", () => {
    it("clears the health data, invalidates suggestions and returns the profile", async () => {
      vi.mocked(storage.withdrawHealthConsent).mockResolvedValue(
        unconsentedProfile,
      );

      const res = await request(app)
        .post("/api/user/health-consent/withdraw")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(storage.withdrawHealthConsent).toHaveBeenCalledWith("1");
      expect(res.body.healthDataConsentAt).toBeNull();
      await lastFireAndForgetPromise;
      expect(storage.invalidateSuggestionCacheForUser).toHaveBeenCalledWith(
        "1",
      );
    });

    it("returns 404 when the user has no profile", async () => {
      vi.mocked(storage.withdrawHealthConsent).mockResolvedValue(undefined);

      const res = await request(app)
        .post("/api/user/health-consent/withdraw")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(404);
    });
  });
});
