import { describe, it, expect } from "vitest";
import { resolveRateLimitMax } from "../_rate-limiters";

/**
 * E2E_RELAXED_RATE_LIMITS exists because the Maestro E2E suite reloads the
 * app once per flow and logs in after each UI logout — a single CI job
 * legitimately produces more logins/status checks in 15 minutes than the
 * production ceilings (10/15min) allow. The knob must multiply generously in
 * non-production and be REFUSED outright in production, no matter what the
 * env says.
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
    expect(resolveRateLimitMax(10, { E2E_RELAXED_RATE_LIMITS: "true" })).toBe(
      10000,
    );
  });

  it("refuses the knob in production — fail closed", () => {
    expect(
      resolveRateLimitMax(10, {
        E2E_RELAXED_RATE_LIMITS: "true",
        NODE_ENV: "production",
      }),
    ).toBe(10);
  });
});
