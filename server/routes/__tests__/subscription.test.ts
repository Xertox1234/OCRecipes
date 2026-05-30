import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { validateReceipt } from "../../services/receipt-validation";
import { register } from "../subscription";
import { _testInternals as streakCacheInternals } from "../../services/verification-streak-cache";
import {
  createMockTransaction,
  createMockUser,
} from "../../__tests__/factories";

vi.mock("../../storage", () => ({
  storage: {
    getSubscriptionStatus: vi.fn(),
    getDailyScanCount: vi.fn(),
    getTransaction: vi.fn(),
    createTransaction: vi.fn(),
    updateSubscription: vi.fn(),
    claimTransactionAndUpgrade: vi.fn(),
    getUserVerificationStats: vi.fn(),
  },
}));

/** Default verification stats — no streak unless a test overrides it. */
const noStreakStats = {
  count: 0,
  frontLabelCount: 0,
  compositeScore: 0,
  streak: 0,
};

vi.mock("../../services/receipt-validation", () => ({
  validateReceipt: vi.fn(),
}));

vi.mock("../../middleware/auth");

vi.mock("express-rate-limit");

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

describe("Subscription Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    streakCacheInternals.streakCache.clear();
    vi.mocked(storage.getUserVerificationStats).mockResolvedValue(
      noStreakStats,
    );
    app = createApp();
  });

  describe("GET /api/subscription/status", () => {
    it("returns free tier for no subscription", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "free",
        expiresAt: null,
      });

      const res = await request(app)
        .get("/api/subscription/status")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.tier).toBe("free");
      expect(res.body.isActive).toBe(true);
    });

    it("returns premium status with expiry", async () => {
      const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "premium",
        expiresAt: futureDate,
      });

      const res = await request(app)
        .get("/api/subscription/status")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.tier).toBe("premium");
      expect(res.body.isActive).toBe(true);
    });

    it("returns expired premium as free", async () => {
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "premium",
        expiresAt: pastDate,
      });

      const res = await request(app)
        .get("/api/subscription/status")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.tier).toBe("free");
      expect(res.body.isActive).toBe(false);
    });

    it("returns 404 when user not found", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue(undefined);

      const res = await request(app)
        .get("/api/subscription/status")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(404);
    });

    it("grants extendedPlanRange to a free user with a 7-day streak", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "free",
        expiresAt: null,
      });
      vi.mocked(storage.getUserVerificationStats).mockResolvedValue({
        ...noStreakStats,
        count: 7,
        compositeScore: 7,
        streak: 7,
      });

      const res = await request(app)
        .get("/api/subscription/status")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.tier).toBe("free");
      expect(res.body.features.extendedPlanRange).toBe(true);
      expect(res.body.streakUnlocks).toEqual(["extendedPlanRange"]);
    });

    it("does not grant extendedPlanRange to a free user below the streak threshold", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "free",
        expiresAt: null,
      });
      vi.mocked(storage.getUserVerificationStats).mockResolvedValue({
        ...noStreakStats,
        count: 6,
        compositeScore: 6,
        streak: 6,
      });

      const res = await request(app)
        .get("/api/subscription/status")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.tier).toBe("free");
      expect(res.body.features.extendedPlanRange).toBe(false);
      expect(res.body.streakUnlocks).toEqual([]);
    });
  });

  describe("GET /api/subscription/scan-count", () => {
    it("returns daily scan count", async () => {
      vi.mocked(storage.getDailyScanCount).mockResolvedValue(5);

      const res = await request(app)
        .get("/api/subscription/scan-count")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(5);
    });
  });

  describe("POST /api/subscription/upgrade", () => {
    const validBody = {
      receipt: "valid-receipt-data",
      platform: "ios",
      productId: "com.ocrecipes.premium",
      transactionId: "client-supplied-txn",
    };

    it("upgrades to premium keyed by the receipt's originalTransactionId, not the client transactionId", async () => {
      vi.mocked(validateReceipt).mockResolvedValue({
        valid: true,
        expiresAt: new Date("2025-12-31"),
        productId: "com.ocrecipes.premium",
        originalTransactionId: "apple-original-txn-1",
      });
      vi.mocked(storage.claimTransactionAndUpgrade).mockResolvedValue({
        status: "created",
        transaction: createMockTransaction(),
        user: createMockUser(),
      });

      const res = await request(app)
        .post("/api/subscription/upgrade")
        .set("Authorization", "Bearer token")
        .send(validBody);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.tier).toBe("premium");
      // The stored key must be the validated receipt's stable id — NOT the
      // client-supplied "client-supplied-txn" (the receipt-replay vector).
      expect(storage.claimTransactionAndUpgrade).toHaveBeenCalledWith(
        expect.objectContaining({ transactionId: "apple-original-txn-1" }),
        "premium",
        expect.any(Date),
      );
    });

    it("fails closed when a valid receipt carries no originalTransactionId", async () => {
      vi.mocked(validateReceipt).mockResolvedValue({
        valid: true,
        expiresAt: new Date("2025-12-31"),
        // no originalTransactionId — must NOT fall back to a synthetic id
      });

      const res = await request(app)
        .post("/api/subscription/upgrade")
        .set("Authorization", "Bearer token")
        .send(validBody);

      expect(res.body.success).toBe(false);
      expect(res.body.tier).not.toBe("premium");
      expect(storage.claimTransactionAndUpgrade).not.toHaveBeenCalled();
    });

    it("rejects with 409 when the subscription is already linked to another account", async () => {
      vi.mocked(validateReceipt).mockResolvedValue({
        valid: true,
        expiresAt: new Date("2025-12-31"),
        originalTransactionId: "apple-original-txn-2",
      });
      vi.mocked(storage.claimTransactionAndUpgrade).mockResolvedValue({
        status: "conflict",
        existingUserId: "some-other-user",
      });

      const res = await request(app)
        .post("/api/subscription/upgrade")
        .set("Authorization", "Bearer token")
        .send(validBody);

      expect(res.status).toBe(409);
    });

    it("handles invalid receipt", async () => {
      vi.mocked(validateReceipt).mockResolvedValue({
        valid: false,
        errorCode: "INVALID_RECEIPT",
      });

      const res = await request(app)
        .post("/api/subscription/upgrade")
        .set("Authorization", "Bearer token")
        .send(validBody);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(storage.claimTransactionAndUpgrade).not.toHaveBeenCalled();
    });

    it("rejects invalid body", async () => {
      const res = await request(app)
        .post("/api/subscription/upgrade")
        .set("Authorization", "Bearer token")
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/subscription/restore", () => {
    const validRestoreBody = { receipt: "receipt-data", platform: "ios" };

    it("restores premium keyed by the receipt's originalTransactionId, not a random id", async () => {
      vi.mocked(validateReceipt).mockResolvedValue({
        valid: true,
        expiresAt: new Date("2025-12-31"),
        productId: "com.ocrecipes.premium",
        originalTransactionId: "apple-original-restore-1",
      });
      vi.mocked(storage.claimTransactionAndUpgrade).mockResolvedValue({
        status: "created",
        transaction: createMockTransaction(),
        user: createMockUser(),
      });

      const res = await request(app)
        .post("/api/subscription/restore")
        .set("Authorization", "Bearer token")
        .send(validRestoreBody);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.tier).toBe("premium");
      expect(storage.claimTransactionAndUpgrade).toHaveBeenCalledWith(
        expect.objectContaining({ transactionId: "apple-original-restore-1" }),
        "premium",
        expect.any(Date),
      );
    });

    it("succeeds when the same user re-claims (renewal)", async () => {
      vi.mocked(validateReceipt).mockResolvedValue({
        valid: true,
        expiresAt: new Date("2026-12-31"),
        originalTransactionId: "apple-original-restore-2",
      });
      vi.mocked(storage.claimTransactionAndUpgrade).mockResolvedValue({
        status: "renewed",
        transaction: createMockTransaction(),
        user: createMockUser(),
      });

      const res = await request(app)
        .post("/api/subscription/restore")
        .set("Authorization", "Bearer token")
        .send(validRestoreBody);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.tier).toBe("premium");
    });

    it("fails closed when a valid receipt carries no originalTransactionId", async () => {
      vi.mocked(validateReceipt).mockResolvedValue({
        valid: true,
        expiresAt: new Date("2025-12-31"),
      });

      const res = await request(app)
        .post("/api/subscription/restore")
        .set("Authorization", "Bearer token")
        .send(validRestoreBody);

      expect(res.body.success).toBe(false);
      expect(res.body.tier).not.toBe("premium");
      expect(storage.claimTransactionAndUpgrade).not.toHaveBeenCalled();
    });

    it("rejects with 409 when the subscription is already linked to another account", async () => {
      vi.mocked(validateReceipt).mockResolvedValue({
        valid: true,
        expiresAt: new Date("2025-12-31"),
        originalTransactionId: "apple-original-restore-3",
      });
      vi.mocked(storage.claimTransactionAndUpgrade).mockResolvedValue({
        status: "conflict",
        existingUserId: "some-other-user",
      });

      const res = await request(app)
        .post("/api/subscription/restore")
        .set("Authorization", "Bearer token")
        .send(validRestoreBody);

      expect(res.status).toBe(409);
    });

    it("handles no valid subscription found", async () => {
      vi.mocked(validateReceipt).mockResolvedValue({
        valid: false,
        errorCode: "NO_SUBSCRIPTION",
      });

      const res = await request(app)
        .post("/api/subscription/restore")
        .set("Authorization", "Bearer token")
        .send(validRestoreBody);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
    });

    it("rejects invalid body", async () => {
      const res = await request(app)
        .post("/api/subscription/restore")
        .set("Authorization", "Bearer token")
        .send({});

      expect(res.status).toBe(400);
    });
  });
});
