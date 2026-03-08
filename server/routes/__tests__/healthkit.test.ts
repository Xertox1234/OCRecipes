import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { syncHealthKitData } from "../../services/healthkit-sync";
import { register } from "../healthkit";

vi.mock("../../storage", () => ({
  storage: {
    getSubscriptionStatus: vi.fn(),
    getHealthKitSyncSettings: vi.fn(),
    upsertHealthKitSyncSetting: vi.fn(),
  },
}));

vi.mock("../../middleware/auth");

vi.mock("express-rate-limit");

vi.mock("../../services/healthkit-sync", () => ({
  syncHealthKitData: vi.fn(),
}));

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

function mockPremium() {
  vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
    tier: "premium",
  } as never);
}

describe("HealthKit Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  describe("POST /api/healthkit/sync", () => {
    it("syncs healthkit data successfully", async () => {
      mockPremium();
      vi.mocked(syncHealthKitData).mockResolvedValue({
        weightsSynced: 2,
      } as never);

      const res = await request(app)
        .post("/api/healthkit/sync")
        .set("Authorization", "Bearer token")
        .send({
          weights: [
            { weight: 75.5, date: "2024-01-15T12:00:00Z", source: "healthkit" },
          ],
        });

      expect(res.status).toBe(200);
      expect(syncHealthKitData).toHaveBeenCalledWith("1", expect.any(Object));
    });

    it("returns 400 for invalid sync data", async () => {
      mockPremium();

      const res = await request(app)
        .post("/api/healthkit/sync")
        .set("Authorization", "Bearer token")
        .send({
          weights: [{ weight: -1, date: "invalid" }],
        });

      expect(res.status).toBe(400);
    });

    it("returns 403 for free tier", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue(null as never);

      const res = await request(app)
        .post("/api/healthkit/sync")
        .set("Authorization", "Bearer token")
        .send({ weights: [] });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("PREMIUM_REQUIRED");
    });
  });

  describe("GET /api/healthkit/settings", () => {
    it("returns sync settings", async () => {
      const settings = [
        { dataType: "weight", enabled: true, syncDirection: "read" },
      ];
      vi.mocked(storage.getHealthKitSyncSettings).mockResolvedValue(
        settings as never,
      );

      const res = await request(app)
        .get("/api/healthkit/settings")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });
  });

  describe("PUT /api/healthkit/settings", () => {
    it("updates sync settings", async () => {
      mockPremium();
      vi.mocked(storage.upsertHealthKitSyncSetting).mockResolvedValue({
        dataType: "weight",
        enabled: true,
        syncDirection: "both",
      } as never);

      const res = await request(app)
        .put("/api/healthkit/settings")
        .set("Authorization", "Bearer token")
        .send({
          settings: [
            { dataType: "weight", enabled: true, syncDirection: "both" },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });

    it("returns 400 for invalid settings", async () => {
      mockPremium();

      const res = await request(app)
        .put("/api/healthkit/settings")
        .set("Authorization", "Bearer token")
        .send({
          settings: [{ dataType: "invalid_type", enabled: true }],
        });

      expect(res.status).toBe(400);
    });

    it("returns 403 for free tier", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue(null as never);

      const res = await request(app)
        .put("/api/healthkit/settings")
        .set("Authorization", "Bearer token")
        .send({
          settings: [{ dataType: "weight", enabled: true }],
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("PREMIUM_REQUIRED");
    });
  });
});
