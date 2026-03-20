import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { storage } from "../../storage";

import { apiRateLimiter, clearUsageCache } from "../api-rate-limit";

vi.mock("../../storage", () => ({
  storage: {
    getApiKeyUsage: vi.fn(),
    incrementApiKeyUsage: vi.fn(),
  },
}));

function createApp(tier = "free") {
  const app = express();
  // Simulate requireApiKey having run
  app.use((req, _res, next) => {
    req.apiKeyId = 1;
    req.apiKeyTier = tier;
    next();
  });
  app.use(apiRateLimiter);
  app.get("/test", (_req, res) => res.json({ ok: true }));
  return app;
}

describe("API Rate Limiter Middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearUsageCache();
  });

  it("sets rate limit headers on response", async () => {
    vi.mocked(storage.getApiKeyUsage).mockResolvedValue(0);
    vi.mocked(storage.incrementApiKeyUsage).mockResolvedValue();

    const app = createApp("free");
    const res = await request(app).get("/test");

    expect(res.status).toBe(200);
    expect(res.headers["x-ratelimit-limit"]).toBe("500");
    expect(res.headers["x-ratelimit-remaining"]).toBe("500");
    expect(res.headers["x-ratelimit-reset"]).toBeDefined();
  });

  it("returns 429 when monthly limit exceeded", async () => {
    vi.mocked(storage.getApiKeyUsage).mockResolvedValue(500);

    const app = createApp("free");
    const res = await request(app).get("/test");

    expect(res.status).toBe(429);
    expect(res.body.code).toBe("TIER_LIMIT_EXCEEDED");
    expect(res.headers["x-ratelimit-remaining"]).toBe("0");
  });

  it("allows requests under the limit", async () => {
    vi.mocked(storage.getApiKeyUsage).mockResolvedValue(100);
    vi.mocked(storage.incrementApiKeyUsage).mockResolvedValue();

    const app = createApp("free");
    const res = await request(app).get("/test");

    expect(res.status).toBe(200);
    expect(res.headers["x-ratelimit-remaining"]).toBe("400");
  });

  it("uses higher limits for paid tiers", async () => {
    vi.mocked(storage.getApiKeyUsage).mockResolvedValue(0);
    vi.mocked(storage.incrementApiKeyUsage).mockResolvedValue();

    const app = createApp("pro");
    const res = await request(app).get("/test");

    expect(res.status).toBe(200);
    expect(res.headers["x-ratelimit-limit"]).toBe("100000");
  });

  it("increments usage on successful request", async () => {
    vi.mocked(storage.getApiKeyUsage).mockResolvedValue(0);
    vi.mocked(storage.incrementApiKeyUsage).mockResolvedValue();

    const app = createApp("free");
    await request(app).get("/test");

    expect(storage.incrementApiKeyUsage).toHaveBeenCalledWith(1);
  });

  it("does not increment usage when rate limited", async () => {
    vi.mocked(storage.getApiKeyUsage).mockResolvedValue(500);

    const app = createApp("free");
    await request(app).get("/test");

    expect(storage.incrementApiKeyUsage).not.toHaveBeenCalled();
  });

  it("fails open when DB is unavailable", async () => {
    vi.mocked(storage.getApiKeyUsage).mockRejectedValue(new Error("DB error"));

    const app = createApp("free");
    const res = await request(app).get("/test");

    // Should pass through, not 500
    expect(res.status).toBe(200);
  });
});
