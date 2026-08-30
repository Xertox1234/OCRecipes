import { describe, it, expect } from "vitest";
import { resolveRateLimitMax } from "../_rate-limiters";

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
