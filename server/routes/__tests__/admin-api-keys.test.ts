import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { storage } from "../../storage";
import { register } from "../admin-api-keys";

vi.mock("../../storage", () => ({
  storage: {
    createApiKey: vi.fn(),
    listApiKeys: vi.fn().mockResolvedValue([]),
    getApiKey: vi.fn().mockResolvedValue(null),
    revokeApiKey: vi.fn(),
    updateApiKeyTier: vi.fn(),
    getApiKeyUsageStats: vi.fn(),
  },
}));

vi.mock("../../middleware/auth");

// Set admin user ID for tests (mock auth sets userId to "1")
vi.stubEnv("ADMIN_USER_IDS", "1");

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

describe("Admin API Keys Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  describe("POST /api/admin/api-keys", () => {
    it("creates a new API key", async () => {
      vi.mocked(storage.createApiKey).mockResolvedValue({
        id: 1,
        keyPrefix: "ocr_live",
        plaintextKey: "ocr_live_abc123def456abc123def456abc123de",
      });

      const res = await request(app)
        .post("/api/admin/api-keys")
        .send({ name: "Test Key", tier: "free" });

      expect(res.status).toBe(201);
      expect(res.body.plaintextKey).toBeDefined();
      expect(res.body.name).toBe("Test Key");
      expect(res.body.tier).toBe("free");
      expect(storage.createApiKey).toHaveBeenCalledWith(
        "Test Key",
        "free",
        "1",
      );
    });

    it("returns 400 for missing name", async () => {
      const res = await request(app)
        .post("/api/admin/api-keys")
        .send({ tier: "free" });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 for invalid tier", async () => {
      const res = await request(app)
        .post("/api/admin/api-keys")
        .send({ name: "Test", tier: "enterprise" });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });

    it("defaults to free tier when not specified", async () => {
      vi.mocked(storage.createApiKey).mockResolvedValue({
        id: 1,
        keyPrefix: "ocr_live",
        plaintextKey: "ocr_live_abc123",
      });

      const res = await request(app)
        .post("/api/admin/api-keys")
        .send({ name: "Test Key" });

      expect(res.status).toBe(201);
      expect(storage.createApiKey).toHaveBeenCalledWith(
        "Test Key",
        "free",
        "1",
      );
    });
  });

  describe("GET /api/admin/api-keys", () => {
    it("lists all API keys with usage", async () => {
      vi.mocked(storage.listApiKeys).mockResolvedValue([
        {
          id: 1,
          keyPrefix: "ocr_live",
          keyHash: "hash",
          name: "Test Key",
          tier: "free",
          status: "active",
          ownerId: "1",
          createdAt: new Date("2026-03-15"),
          revokedAt: null,
        },
      ]);
      vi.mocked(storage.getApiKeyUsageStats).mockResolvedValue({
        yearMonth: "2026-03",
        requestCount: 42,
      });

      const res = await request(app).get("/api/admin/api-keys");

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe("Test Key");
      expect(res.body.data[0].usage.requestCount).toBe(42);
      // Should not expose keyHash
      expect(res.body.data[0].keyHash).toBeUndefined();
    });
  });

  describe("DELETE /api/admin/api-keys/:id", () => {
    it("revokes an existing API key", async () => {
      vi.mocked(storage.getApiKey).mockResolvedValue({
        id: 1,
        keyPrefix: "ocr_live",
        keyHash: "hash",
        name: "Test",
        tier: "free",
        status: "active",
        ownerId: "1",
        createdAt: new Date(),
        revokedAt: null,
      });

      const res = await request(app).delete("/api/admin/api-keys/1");

      expect(res.status).toBe(200);
      expect(storage.revokeApiKey).toHaveBeenCalledWith(1);
    });

    it("returns 404 for non-existent key", async () => {
      vi.mocked(storage.getApiKey).mockResolvedValue(null);

      const res = await request(app).delete("/api/admin/api-keys/999");

      expect(res.status).toBe(404);
    });

    it("returns 400 for non-numeric ID", async () => {
      const res = await request(app).delete("/api/admin/api-keys/abc");

      expect(res.status).toBe(400);
    });
  });

  describe("PATCH /api/admin/api-keys/:id", () => {
    it("updates an API key tier", async () => {
      vi.mocked(storage.getApiKey).mockResolvedValue({
        id: 1,
        keyPrefix: "ocr_live",
        keyHash: "hash",
        name: "Test",
        tier: "free",
        status: "active",
        ownerId: "1",
        createdAt: new Date(),
        revokedAt: null,
      });

      const res = await request(app)
        .patch("/api/admin/api-keys/1")
        .send({ tier: "pro" });

      expect(res.status).toBe(200);
      expect(storage.updateApiKeyTier).toHaveBeenCalledWith(1, "pro");
    });

    it("returns 400 for invalid tier", async () => {
      const res = await request(app)
        .patch("/api/admin/api-keys/1")
        .send({ tier: "invalid" });

      expect(res.status).toBe(400);
    });
  });
});
