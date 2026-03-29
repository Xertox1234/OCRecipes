import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { validateReceipt } from "../../services/receipt-validation";
import { register } from "../subscription";
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
    createTransactionAndUpgrade: vi.fn(),
  },
}));

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
      transactionId: "txn-123",
    };

    it("upgrades to premium with valid receipt", async () => {
      vi.mocked(storage.getTransaction).mockResolvedValue(undefined);
      vi.mocked(validateReceipt).mockResolvedValue({
        valid: true,
        expiresAt: new Date("2025-12-31"),
      });
      vi.mocked(storage.createTransactionAndUpgrade).mockResolvedValue({
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
    });

    it("rejects duplicate transaction", async () => {
      vi.mocked(storage.getTransaction).mockResolvedValue(
        createMockTransaction({ id: 1 }),
      );

      const res = await request(app)
        .post("/api/subscription/upgrade")
        .set("Authorization", "Bearer token")
        .send(validBody);

      expect(res.status).toBe(409);
    });

    it("handles invalid receipt", async () => {
      vi.mocked(storage.getTransaction).mockResolvedValue(undefined);
      vi.mocked(validateReceipt).mockResolvedValue({
        valid: false,
        errorCode: "INVALID_RECEIPT",
      });
      vi.mocked(storage.createTransaction).mockResolvedValue(
        createMockTransaction(),
      );

      const res = await request(app)
        .post("/api/subscription/upgrade")
        .set("Authorization", "Bearer token")
        .send(validBody);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
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
    it("restores premium subscription", async () => {
      vi.mocked(validateReceipt).mockResolvedValue({
        valid: true,
        expiresAt: new Date("2025-12-31"),
      });
      vi.mocked(storage.createTransactionAndUpgrade).mockResolvedValue({
        transaction: createMockTransaction(),
        user: createMockUser(),
      });

      const res = await request(app)
        .post("/api/subscription/restore")
        .set("Authorization", "Bearer token")
        .send({ receipt: "receipt-data", platform: "ios" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.tier).toBe("premium");
    });

    it("handles no valid subscription found", async () => {
      vi.mocked(validateReceipt).mockResolvedValue({
        valid: false,
        errorCode: "NO_SUBSCRIPTION",
      });

      const res = await request(app)
        .post("/api/subscription/restore")
        .set("Authorization", "Bearer token")
        .send({ receipt: "receipt-data", platform: "ios" });

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
