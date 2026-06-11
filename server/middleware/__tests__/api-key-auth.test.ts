import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { storage } from "../../storage";

// Must import AFTER mocks
import {
  requireApiKey,
  clearApiKeyCache,
  invalidateApiKeyCacheById,
} from "../api-key-auth";

// We need bcrypt for the hash comparison. Create a real hash for testing.
import bcrypt from "bcrypt";

import { createMockApiKey } from "../../__tests__/factories";

vi.mock("../../storage", () => ({
  storage: {
    getApiKeyByPrefix: vi.fn().mockResolvedValue(undefined),
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
    // Cast: `vi.mocked()` infers the success-path return shape; explicit
    // cast lets us mock the not-found return without expanding the typed
    // surface of every storage helper.
    vi.mocked(storage.getApiKeyByPrefix).mockResolvedValue(
      undefined as unknown as Awaited<
        ReturnType<typeof storage.getApiKeyByPrefix>
      >,
    );

    const res = await request(app).get("/test").set("X-API-Key", TEST_KEY);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("API_KEY_INVALID");
  });

  it("returns 401 when API key hash does not match", async () => {
    vi.mocked(storage.getApiKeyByPrefix).mockResolvedValue(
      createMockApiKey({
        keyPrefix: TEST_PREFIX,
        keyHash: await bcrypt.hash("wrong_key", 10),
        name: "Test",
        tier: "free",
      }),
    );

    const res = await request(app).get("/test").set("X-API-Key", TEST_KEY);
    expect(res.status).toBe(401);
  });

  it("returns 401 when API key is revoked", async () => {
    vi.mocked(storage.getApiKeyByPrefix).mockResolvedValue(
      createMockApiKey({
        keyPrefix: TEST_PREFIX,
        keyHash: testKeyHash,
        name: "Test",
        status: "revoked",
        revokedAt: new Date(),
      }),
    );

    const res = await request(app).get("/test").set("X-API-Key", TEST_KEY);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("API_KEY_REVOKED");
  });

  it("sets apiKeyId and apiKeyTier on valid key", async () => {
    vi.mocked(storage.getApiKeyByPrefix).mockResolvedValue(
      createMockApiKey({
        id: 42,
        keyPrefix: TEST_PREFIX,
        keyHash: testKeyHash,
        name: "Test",
        tier: "starter",
      }),
    );

    const res = await request(app).get("/test").set("X-API-Key", TEST_KEY);
    expect(res.status).toBe(200);
    expect(res.body.apiKeyId).toBe(42);
    expect(res.body.apiKeyTier).toBe("starter");
  });

  it("caches validated keys and skips DB on subsequent requests", async () => {
    vi.mocked(storage.getApiKeyByPrefix).mockResolvedValue(
      createMockApiKey({
        keyPrefix: TEST_PREFIX,
        keyHash: testKeyHash,
        name: "Test",
      }),
    );

    // First request — cache miss
    await request(app).get("/test").set("X-API-Key", TEST_KEY);
    expect(storage.getApiKeyByPrefix).toHaveBeenCalledTimes(1);

    // Second request — cache hit
    await request(app).get("/test").set("X-API-Key", TEST_KEY);
    expect(storage.getApiKeyByPrefix).toHaveBeenCalledTimes(1); // still 1
  });

  describe("invalidateApiKeyCacheById", () => {
    const TEST_KEY_B = "ocr_live_fedcba9876543210fedcba9876543210";
    const TEST_PREFIX_B = TEST_KEY_B.substring(0, 16);
    let testKeyHashB: string;

    beforeAll(async () => {
      testKeyHashB = await bcrypt.hash(TEST_KEY_B, 10);
    });

    it("evicts only the targeted key — unrelated cached key still authenticates from cache", async () => {
      const keyRowA = createMockApiKey({
        id: 1,
        keyPrefix: TEST_PREFIX,
        keyHash: testKeyHash,
        name: "Key A",
      });
      const keyRowB = createMockApiKey({
        id: 2,
        keyPrefix: TEST_PREFIX_B,
        keyHash: testKeyHashB,
        name: "Key B",
      });
      vi.mocked(storage.getApiKeyByPrefix).mockImplementation(
        async (prefix: string) => (prefix === TEST_PREFIX ? keyRowA : keyRowB),
      );

      // Prime the cache for both keys
      const primeA = await request(app).get("/test").set("X-API-Key", TEST_KEY);
      expect(primeA.status).toBe(200);
      const primeB = await request(app)
        .get("/test")
        .set("X-API-Key", TEST_KEY_B);
      expect(primeB.status).toBe(200);
      expect(storage.getApiKeyByPrefix).toHaveBeenCalledTimes(2);

      // Revoke key A in the DB, then targeted-evict only its cache entry
      const revokedRowA = createMockApiKey({
        id: 1,
        keyPrefix: TEST_PREFIX,
        keyHash: testKeyHash,
        name: "Key A",
        status: "revoked",
        revokedAt: new Date(),
      });
      vi.mocked(storage.getApiKeyByPrefix).mockImplementation(
        async (prefix: string) =>
          prefix === TEST_PREFIX ? revokedRowA : keyRowB,
      );
      invalidateApiKeyCacheById(1);

      // Unrelated key B is still served from cache — no new DB lookup
      const resB = await request(app).get("/test").set("X-API-Key", TEST_KEY_B);
      expect(resB.status).toBe(200);
      expect(resB.body.apiKeyId).toBe(2);
      expect(storage.getApiKeyByPrefix).toHaveBeenCalledTimes(2); // still 2

      // Revoked key A was evicted — its very next request re-validates and is rejected
      const resA = await request(app).get("/test").set("X-API-Key", TEST_KEY);
      expect(resA.status).toBe(401);
      expect(resA.body.code).toBe("API_KEY_REVOKED");
      expect(storage.getApiKeyByPrefix).toHaveBeenCalledTimes(3);
    });
  });
});
