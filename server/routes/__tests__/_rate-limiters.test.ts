import { describe, it, expect, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { resolveRateLimitMax, createRateLimiter } from "../_rate-limiters";

/**
 * E2E_RELAXED_RATE_LIMITS exists because the Maestro E2E suite reloads the
 * app once per flow and logs in after each UI logout — a single CI job
 * legitimately produces more logins/status checks in 15 minutes than the
 * production ceilings (10/15min) allow. The knob must multiply generously
 * ONLY when NODE_ENV is explicitly "development" or "test" (allowlist) —
 * unset or unrecognized values stay at production limits, because Railway's
 * `railway run` and dashboard-overridden startCommands run with NODE_ENV
 * unset.
 */
describe("resolveRateLimitMax", () => {
  it("returns the configured max unchanged when the knob is unset", () => {
    expect(resolveRateLimitMax(10, {})).toBe(10);
  });

  it("returns the configured max unchanged for non-'true' values", () => {
    expect(resolveRateLimitMax(10, { E2E_RELAXED_RATE_LIMITS: "1" })).toBe(10);
    expect(resolveRateLimitMax(10, { E2E_RELAXED_RATE_LIMITS: "yes" })).toBe(
      10,
    );
    expect(resolveRateLimitMax(10, { E2E_RELAXED_RATE_LIMITS: "" })).toBe(10);
  });

  it("multiplies the max by 1000 when the knob is 'true' outside production", () => {
    expect(
      resolveRateLimitMax(10, {
        E2E_RELAXED_RATE_LIMITS: "true",
        NODE_ENV: "development",
      }),
    ).toBe(10000);
    expect(
      resolveRateLimitMax(10, {
        E2E_RELAXED_RATE_LIMITS: "true",
        NODE_ENV: "test",
      }),
    ).toBe(10000);
  });

  it("refuses the knob outside an explicit dev/test env — fail closed (allowlist)", () => {
    // (kept last in this describe — the endpoint-level suites below stub env)
    // Railway's `railway run` and a dashboard-overridden startCommand run
    // with NODE_ENV unset — an unset or unrecognized value must stay at
    // production limits (docs/rules/database.md's NODE_ENV-guard rule).
    expect(
      resolveRateLimitMax(10, {
        E2E_RELAXED_RATE_LIMITS: "true",
        NODE_ENV: "production",
      }),
    ).toBe(10);
    expect(resolveRateLimitMax(10, { E2E_RELAXED_RATE_LIMITS: "true" })).toBe(
      10,
    );
    expect(
      resolveRateLimitMax(10, {
        E2E_RELAXED_RATE_LIMITS: "true",
        NODE_ENV: "Production",
      }),
    ).toBe(10);
  });
});

/** Minimal app mounting a limiter in front of a failing-login handler (401 =
 * a counted request for skipSuccessfulRequests limiters, and a plain counted
 * request for the factory ones). */
function appWithLimiter(limiter: express.RequestHandler) {
  const app = express();
  app.use(express.json());
  app.post("/login", limiter, (_req, res) => {
    // Not the real route — a status-only stub (the tests assert status codes,
    // so no sendError body shape is needed here).
    res.status(401).json({ code: "INVALID_CREDENTIALS" });
  });
  return app;
}

// docs/rules/testing.md: a rate-limiter test must call the endpoint N+1 times
// and assert the (N+1)th response is 429 — a pure-function check of
// resolveRateLimitMax alone would stay green if the factory stopped calling it.
describe("createRateLimiter endpoint enforcement", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 429 on the (N+1)th request at the configured max", async () => {
    vi.stubEnv("E2E_RELAXED_RATE_LIMITS", "");
    const app = appWithLimiter(
      createRateLimiter({
        windowMs: 60_000,
        max: 2,
        message: "Too many requests",
        keyByUser: false,
      }),
    );
    for (let i = 0; i < 2; i++) {
      const res = await request(app).post("/login").send({});
      expect(res.status).toBe(401);
    }
    const overflow = await request(app).post("/login").send({});
    expect(overflow.status).toBe(429);
    expect(overflow.body.code).toBe("RATE_LIMITED");
  });

  it("relaxes the live middleware when the knob is armed in a test env", async () => {
    vi.stubEnv("E2E_RELAXED_RATE_LIMITS", "true");
    vi.stubEnv("NODE_ENV", "test");
    const app = appWithLimiter(
      createRateLimiter({
        windowMs: 60_000,
        max: 1,
        message: "Too many requests",
        keyByUser: false,
      }),
    );
    for (let i = 0; i < 5; i++) {
      const res = await request(app).post("/login").send({});
      expect(res.status).toBe(401);
    }
  });
});

// loginAccountLimiter is created at module scope, so its max is resolved from
// the env at import time — each case re-imports the module (fresh MemoryStore,
// fresh env read) instead of resetting store keys.
describe("loginAccountLimiter", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function importLimiterWith(env: Record<string, string>) {
    vi.resetModules();
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    const mod = await import("../_rate-limiters");
    return mod.loginAccountLimiter;
  }

  it("throttles the 11th failed login for one account at production limits", async () => {
    const limiter = await importLimiterWith({ E2E_RELAXED_RATE_LIMITS: "" });
    const app = appWithLimiter(limiter);
    for (let i = 0; i < 10; i++) {
      const res = await request(app)
        .post("/login")
        .send({ username: "testuser", password: "wrong" });
      expect(res.status).toBe(401);
    }
    const overflow = await request(app)
      .post("/login")
      .send({ username: "testuser", password: "wrong" });
    expect(overflow.status).toBe(429);
  });

  it("honors E2E_RELAXED_RATE_LIMITS like the factory limiters do", async () => {
    // Without this, an E2E flake storm of failed logins (all keyed to the one
    // shared CI account) locks out every later flow's login with a 429 that
    // is byte-identical to the relaxed loginLimiter's — invisible to the knob.
    const limiter = await importLimiterWith({
      E2E_RELAXED_RATE_LIMITS: "true",
      NODE_ENV: "test",
    });
    const app = appWithLimiter(limiter);
    for (let i = 0; i < 11; i++) {
      const res = await request(app)
        .post("/login")
        .send({ username: "testuser", password: "wrong" });
      expect(res.status).toBe(401);
    }
  });
});
