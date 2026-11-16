import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { register } from "../family";
import { register as registerProfile } from "../profile";
import { createMockUserProfile } from "../../__tests__/factories";

vi.mock("../../storage", () => ({
  storage: {
    getEffectiveTierForUser: vi.fn(),
    getUserProfile: vi.fn(),
    updateUserProfile: vi.fn(),
    setFamilyPlanningEnabled: vi.fn(),
    getFamilyProfiles: vi.fn(),
    createFamilyProfile: vi.fn(),
    updateFamilyProfile: vi.fn(),
    deleteFamilyProfile: vi.fn(),
    invalidateSuggestionCacheForUser: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../lib/fire-and-forget", () => ({
  fireAndForget: () => {},
}));

vi.mock("../../middleware/auth");

vi.mock("express-rate-limit");

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  registerProfile(app);
  return app;
}

const kid = {
  id: 5,
  userId: "1",
  name: "Kid",
  allergies: [],
  note: null,
  sortOrder: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const body = { name: "Kid", allergies: [], note: null };
const withAllergy = {
  name: "Kid",
  allergies: [{ name: "peanut", severity: "severe" }],
  note: null,
};

function setPremium() {
  vi.mocked(storage.getEffectiveTierForUser).mockResolvedValue("premium");
}

function setConsent(on: boolean) {
  vi.mocked(storage.getUserProfile).mockResolvedValue(
    createMockUserProfile({
      healthDataConsentAt: on ? new Date() : null,
    }),
  );
}

describe("Family routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storage.getEffectiveTierForUser).mockResolvedValue("free");
    setConsent(false);
    app = createApp();
  });

  describe("free user", () => {
    it("POST profile is 403 PREMIUM_REQUIRED", async () => {
      const res = await request(app).post("/api/family-profiles").send(body);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("PREMIUM_REQUIRED");
      expect(storage.createFamilyProfile).not.toHaveBeenCalled();
    });

    it("PUT profile is 403 PREMIUM_REQUIRED", async () => {
      const res = await request(app).put("/api/family-profiles/5").send(body);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("PREMIUM_REQUIRED");
    });

    it("turning the switch on is 403", async () => {
      const res = await request(app)
        .put("/api/family-planning")
        .send({ enabled: true });
      expect(res.status).toBe(403);
      expect(storage.setFamilyPlanningEnabled).not.toHaveBeenCalled();
    });

    it("turning the switch off is 200", async () => {
      vi.mocked(storage.setFamilyPlanningEnabled).mockResolvedValue(false);
      const res = await request(app)
        .put("/api/family-planning")
        .send({ enabled: false });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ enabled: false });
    });

    it("GET lists profiles with the stored switch value", async () => {
      vi.mocked(storage.getUserProfile).mockResolvedValue(
        createMockUserProfile({ familyPlanningEnabled: true }),
      );
      vi.mocked(storage.getFamilyProfiles).mockResolvedValue([kid]);
      const res = await request(app).get("/api/family-profiles");
      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(true);
      expect(res.body.profiles).toHaveLength(1);
    });

    it("GET says enabled false when there is no profile row", async () => {
      vi.mocked(storage.getUserProfile).mockResolvedValue(undefined);
      vi.mocked(storage.getFamilyProfiles).mockResolvedValue([]);
      const res = await request(app).get("/api/family-profiles");
      expect(res.body).toEqual({ enabled: false, profiles: [] });
    });

    it("DELETE is 204", async () => {
      vi.mocked(storage.deleteFamilyProfile).mockResolvedValue(true);
      const res = await request(app).delete("/api/family-profiles/5");
      expect(res.status).toBe(204);
      expect(storage.deleteFamilyProfile).toHaveBeenCalledWith(5, "1");
    });
  });

  describe("premium user", () => {
    beforeEach(setPremium);

    it("creates a profile (name only, no consent needed)", async () => {
      vi.mocked(storage.createFamilyProfile).mockResolvedValue(kid);
      const res = await request(app).post("/api/family-profiles").send(body);
      expect(res.status).toBe(201);
      expect(res.body.name).toBe("Kid");
      expect(storage.createFamilyProfile).toHaveBeenCalledWith("1", body);
    });

    it("rejects a 51-character name", async () => {
      const res = await request(app)
        .post("/api/family-profiles")
        .send({ ...body, name: "a".repeat(51) });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });

    it("POST with allergies and no consent is HEALTH_CONSENT_REQUIRED", async () => {
      const res = await request(app)
        .post("/api/family-profiles")
        .send(withAllergy);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("HEALTH_CONSENT_REQUIRED");
      expect(storage.createFamilyProfile).not.toHaveBeenCalled();
    });

    it("POST with a note and no consent is HEALTH_CONSENT_REQUIRED", async () => {
      const res = await request(app)
        .post("/api/family-profiles")
        .send({ ...body, note: "tree nut free house" });
      expect(res.body.code).toBe("HEALTH_CONSENT_REQUIRED");
    });

    it("POST with allergies and consent is 201", async () => {
      setConsent(true);
      vi.mocked(storage.createFamilyProfile).mockResolvedValue(kid);
      const res = await request(app)
        .post("/api/family-profiles")
        .send(withAllergy);
      expect(res.status).toBe(201);
    });

    it("PUT with allergies and no consent is HEALTH_CONSENT_REQUIRED", async () => {
      const res = await request(app)
        .put("/api/family-profiles/5")
        .send(withAllergy);
      expect(res.body.code).toBe("HEALTH_CONSENT_REQUIRED");
      expect(storage.updateFamilyProfile).not.toHaveBeenCalled();
    });

    it("PUT name only without consent is 200", async () => {
      vi.mocked(storage.updateFamilyProfile).mockResolvedValue(kid);
      const res = await request(app).put("/api/family-profiles/5").send(body);
      expect(res.status).toBe(200);
      expect(storage.updateFamilyProfile).toHaveBeenCalledWith(5, "1", body);
    });

    it("POST answers 409 LIMIT_REACHED when storage says limit", async () => {
      vi.mocked(storage.createFamilyProfile).mockResolvedValue("limit");
      const res = await request(app).post("/api/family-profiles").send(body);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("LIMIT_REACHED");
    });

    it("PUT of an id that is not the user's is 404", async () => {
      vi.mocked(storage.updateFamilyProfile).mockResolvedValue(undefined);
      const res = await request(app).put("/api/family-profiles/9").send(body);
      expect(res.status).toBe(404);
    });

    it("DELETE of an id that is not the user's is 404", async () => {
      vi.mocked(storage.deleteFamilyProfile).mockResolvedValue(false);
      const res = await request(app).delete("/api/family-profiles/9");
      expect(res.status).toBe(404);
    });

    it("turning the switch on is 200", async () => {
      vi.mocked(storage.setFamilyPlanningEnabled).mockResolvedValue(true);
      const res = await request(app)
        .put("/api/family-planning")
        .send({ enabled: true });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ enabled: true });
      expect(storage.setFamilyPlanningEnabled).toHaveBeenCalledWith("1", true);
    });

    it("rejects a non-boolean switch body", async () => {
      const res = await request(app)
        .put("/api/family-planning")
        .send({ enabled: "yes" });
      expect(res.status).toBe(400);
    });
  });

  describe("dietary profile cannot set the switch", () => {
    it("PUT /api/user/dietary-profile drops familyPlanningEnabled", async () => {
      setConsent(true);
      vi.mocked(storage.updateUserProfile).mockResolvedValue(
        createMockUserProfile(),
      );
      const res = await request(app)
        .put("/api/user/dietary-profile")
        .send({ dietType: "vegan", familyPlanningEnabled: true });
      expect(res.status).toBe(200);
      const updates = vi.mocked(storage.updateUserProfile).mock.calls[0][1];
      expect(updates).not.toHaveProperty("familyPlanningEnabled");
      expect(updates).toHaveProperty("dietType", "vegan");
    });
  });
});
