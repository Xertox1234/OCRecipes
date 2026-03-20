import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { storage } from "../../storage";

// Must import AFTER mocks
import { requireApiKey, clearApiKeyCache } from "../api-key-auth";

// We need bcrypt for the hash comparison. Create a real hash for testing.
import bcrypt from "bcrypt";

vi.mock("../../storage", () => ({
  storage: {
    getApiKeyByPrefix: vi.fn().mockResolvedValue(null),
  },
}));

const TEST_KEY = "ocr_live_0123456789abcdef0123456789abcdef";
const TEST_PREFIX = "ocr_live_0123456";
let testKeyHash: string;

function createApp() {
  const app = express();
  app.use(express.json());
  app.get("/test", requireApiKey, (_req, res) => {
    res.json({
      apiKeyId: _req.apiKeyId,
      apiKeyTier: _req.apiKeyTier,
    });
  });
  return app;
}

describe("API Key Auth Middleware", () => {
  let app: express.Express;

  beforeAll(async () => {
    testKeyHash = await bcrypt.hash(TEST_KEY, 10);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    clearApiKeyCache();
    app = createApp();
  });

  it("returns 401 when no API key header is provided", async () => {
    const res = await request(app).get("/test");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("API_KEY_INVALID");
  });

  it("returns 400 when API key is in query param", async () => {
    const res = await request(app).get("/test?api_key=some_key");
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("header");
  });

  it("returns 400 when API key is in camelCase query param", async () => {
    const res = await request(app).get("/test?apiKey=some_key");
    expect(res.status).toBe(400);
  });

  it("returns 401 when API key prefix not found in DB", async () => {
    vi.mocked(storage.getApiKeyByPrefix).mockResolvedValue(null as never);

    const res = await request(app).get("/test").set("X-API-Key", TEST_KEY);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("API_KEY_INVALID");
  });

  it("returns 401 when API key hash does not match", async () => {
    vi.mocked(storage.getApiKeyByPrefix).mockResolvedValue({
      id: 1,
      keyPrefix: TEST_PREFIX,
      keyHash: await bcrypt.hash("wrong_key", 10),
      name: "Test",
      tier: "free",
      status: "active",
      ownerId: "1",
      createdAt: new Date(),
      revokedAt: null,
    });

    const res = await request(app).get("/test").set("X-API-Key", TEST_KEY);
    expect(res.status).toBe(401);
  });

  it("returns 401 when API key is revoked", async () => {
    vi.mocked(storage.getApiKeyByPrefix).mockResolvedValue({
      id: 1,
      keyPrefix: TEST_PREFIX,
      keyHash: testKeyHash,
      name: "Test",
      tier: "free",
      status: "revoked",
      ownerId: "1",
      createdAt: new Date(),
      revokedAt: new Date(),
    });

    const res = await request(app).get("/test").set("X-API-Key", TEST_KEY);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("API_KEY_REVOKED");
  });

  it("sets apiKeyId and apiKeyTier on valid key", async () => {
    vi.mocked(storage.getApiKeyByPrefix).mockResolvedValue({
      id: 42,
      keyPrefix: TEST_PREFIX,
      keyHash: testKeyHash,
      name: "Test",
      tier: "starter",
      status: "active",
      ownerId: "1",
      createdAt: new Date(),
      revokedAt: null,
    });

    const res = await request(app).get("/test").set("X-API-Key", TEST_KEY);
    expect(res.status).toBe(200);
    expect(res.body.apiKeyId).toBe(42);
    expect(res.body.apiKeyTier).toBe("starter");
  });

  it("caches validated keys and skips DB on subsequent requests", async () => {
    vi.mocked(storage.getApiKeyByPrefix).mockResolvedValue({
      id: 1,
      keyPrefix: TEST_PREFIX,
      keyHash: testKeyHash,
      name: "Test",
      tier: "free",
      status: "active",
      ownerId: "1",
      createdAt: new Date(),
      revokedAt: null,
    });

    // First request — cache miss
    await request(app).get("/test").set("X-API-Key", TEST_KEY);
    expect(storage.getApiKeyByPrefix).toHaveBeenCalledTimes(1);

    // Second request — cache hit
    await request(app).get("/test").set("X-API-Key", TEST_KEY);
    expect(storage.getApiKeyByPrefix).toHaveBeenCalledTimes(1); // still 1
  });
});
