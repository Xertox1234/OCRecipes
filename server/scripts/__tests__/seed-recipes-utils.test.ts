import { describe, it, expect } from "vitest";
import {
  ALLOW_PROD_SEED_FLAG,
  shouldSeedAsPlatformOwned,
} from "../seed-recipes-utils";

/**
 * These tests pin the safety contract for seeding the LIVE backend:
 * a `demo` test account must never be created in prod, so the authorless/
 * no-account decision must fire whenever the operator opts in via the flag —
 * even when `railway run` fails to inject NODE_ENV (mirrors
 * backfill-email-verified-utils).
 */
describe("seed-recipes-utils", () => {
  it("ALLOW_PROD_SEED_FLAG is the exact opt-in flag", () => {
    expect(ALLOW_PROD_SEED_FLAG).toBe("--allow-prod-seed");
  });

  describe("shouldSeedAsPlatformOwned", () => {
    it("is true when the flag is passed even if NODE_ENV is unset (railway run case)", () => {
      expect(
        shouldSeedAsPlatformOwned({ allowProdSeed: true, nodeEnv: undefined }),
      ).toBe(true);
    });

    it("is true when NODE_ENV=production even without the flag (belt-and-suspenders)", () => {
      expect(
        shouldSeedAsPlatformOwned({
          allowProdSeed: false,
          nodeEnv: "production",
        }),
      ).toBe(true);
    });

    it("is true when both the flag and production env are set", () => {
      expect(
        shouldSeedAsPlatformOwned({
          allowProdSeed: true,
          nodeEnv: "production",
        }),
      ).toBe(true);
    });

    it("is false for local dev (no flag, non-production env)", () => {
      expect(
        shouldSeedAsPlatformOwned({
          allowProdSeed: false,
          nodeEnv: "development",
        }),
      ).toBe(false);
      expect(
        shouldSeedAsPlatformOwned({ allowProdSeed: false, nodeEnv: undefined }),
      ).toBe(false);
    });
  });
});
