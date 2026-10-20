import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import type { Server } from "node:http";

vi.mock("../../storage", () => ({
  storage: {
    getLibraryCounts: vi.fn(),
  },
}));

vi.mock("../../middleware/auth");
// express-rate-limit is deliberately NOT mocked: this suite exercises the real
// limiter (docs/rules/testing.md — call N+1 times, assert the (N+1)th is 429).

describe("profile hub rate limit (QA sweep #61)", () => {
  let server: Server;
  let max: number;
  let get: () => request.Test;

  beforeEach(async () => {
    // hubRateLimit is a module-level limiter whose MemoryStore lives as long as
    // the module. A fresh module graph per attempt means a vitest retry never
    // inherits the previous attempt's hit count. storage must be re-imported
    // from the SAME fresh graph so the route and the mock share one instance.
    vi.resetModules();
    const { storage } = await import("../../storage");
    const hub = await import("../profile-hub");
    vi.mocked(storage.getLibraryCounts).mockResolvedValue({} as any);
    max = hub.PROFILE_HUB_RATE_LIMIT_MAX;

    const app = express();
    hub.register(app);
    // Bind the one server explicitly to 127.0.0.1. supertest(app) would open
    // a fresh wildcard ([::]) listener per request, and on macOS another
    // process may bind 127.0.0.1:<same ephemeral port> beside it — the client
    // then reaches that foreign server (observed: Dart shelf 403, a foreign
    // Express 401, a 400 "WebSockets request was expected"). Those responses
    // never reach our limiter, so the hit count never gets to max.
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    get = () => request(server).get("/api/profile/library-counts");
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it("does not trip on the old 15/min ceiling, then 429s at the new max", async () => {
    // Every request up to max must be answered by OUR limiter: a 200 that
    // carries its RateLimit header. A response from anything else fails here
    // with a clear message instead of silently under-counting.
    for (let i = 0; i < max; i++) {
      const res = await get();
      expect(res.status, `request ${i + 1} of ${max}`).toBe(200);
      expect(
        res.headers["ratelimit-limit"],
        `request ${i + 1} of ${max}`,
      ).toBeDefined();
    }
    const overflow = await get();
    expect(overflow.status).toBe(429);
    expect(overflow.body.code).toBe("RATE_LIMITED");
  });
});
