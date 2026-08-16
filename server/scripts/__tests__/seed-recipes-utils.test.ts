import { describe, it, expect } from "vitest";
import {
  ALLOW_PROD_SEED_FLAG,
  shouldSeedAsPlatformOwned,
  isLocalDbHost,
  assertLocalDbForDemoAccount,
  evaluateProdSeedGuard,
  resolveDemoPassword,
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
      // Unreachable through main() today — evaluateProdSeedGuard exits first.
      // Retained deliberately as layer 2 of the defense stack (guard →
      // platform-owned → assertLocalDbForDemoAccount), so a future reorder of
      // main() still cannot create a demo account in prod.
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

  describe("isLocalDbHost", () => {
    it("is true for localhost", () => {
      expect(isLocalDbHost("postgresql://localhost/nutricam")).toBe(true);
    });

    it("is true for 127.0.0.1 with creds and port", () => {
      expect(isLocalDbHost("postgresql://user:pass@127.0.0.1:5432/db")).toBe(
        true,
      );
    });

    it("is true for a hostless (unix-socket) url", () => {
      expect(isLocalDbHost("postgresql:///nutricam")).toBe(true);
    });

    it("is true for ::1 (IPv6 loopback)", () => {
      expect(isLocalDbHost("postgresql://[::1]/db")).toBe(true);
    });

    it("is false for a remote railway host", () => {
      expect(
        isLocalDbHost(
          "postgresql://user:pass@containers-us-west-1.railway.app:5432/railway",
        ),
      ).toBe(false);
    });

    it("is false (fail-closed) for undefined, empty, or unparseable urls", () => {
      expect(isLocalDbHost(undefined)).toBe(false);
      expect(isLocalDbHost("")).toBe(false);
      expect(isLocalDbHost("not a url")).toBe(false);
    });
  });

  describe("assertLocalDbForDemoAccount", () => {
    it("does not throw for a local host", () => {
      expect(() =>
        assertLocalDbForDemoAccount("postgresql://localhost/nutricam"),
      ).not.toThrow();
    });

    it("throws and names the host for a remote db", () => {
      expect(() =>
        assertLocalDbForDemoAccount(
          "postgresql://user:pass@db.prod.example.com:5432/app",
        ),
      ).toThrow(/non-local DB host 'db\.prod\.example\.com'/);
    });

    it("throws fail-closed for an unset url", () => {
      expect(() => assertLocalDbForDemoAccount(undefined)).toThrow(/\(unset\)/);
    });

    it("throws fail-closed for an unparseable url", () => {
      expect(() => assertLocalDbForDemoAccount("not a url")).toThrow(
        /\(unparseable\)/,
      );
    });
  });

  describe("evaluateProdSeedGuard (the M3 refusal main() enforces)", () => {
    it("REFUSES production without the flag, naming the override", () => {
      const decision = evaluateProdSeedGuard({
        nodeEnv: "production",
        allowProdSeed: false,
      });
      expect(decision.refuse).toBe(true);
      if (!decision.refuse) return;
      expect(decision.messages.join("\n")).toContain(
        "Refusing to seed in NODE_ENV=production",
      );
      expect(decision.messages.join("\n")).toContain("--allow-prod-seed");
    });

    it("allows production WITH the flag but carries the live-DB warning", () => {
      const decision = evaluateProdSeedGuard({
        nodeEnv: "production",
        allowProdSeed: true,
      });
      expect(decision.refuse).toBe(false);
      if (decision.refuse) return;
      expect(decision.warning).toContain("--allow-prod-seed");
      expect(decision.warning).toContain("live DB");
    });

    it("allows dev runs silently, with or without the flag (non-vacuity control)", () => {
      const bare = evaluateProdSeedGuard({
        nodeEnv: "development",
        allowProdSeed: false,
      });
      expect(bare).toEqual({ refuse: false });
      const flagged = evaluateProdSeedGuard({
        nodeEnv: undefined,
        allowProdSeed: true,
      });
      expect(flagged).toEqual({ refuse: false });
    });
  });

  describe("resolveDemoPassword", () => {
    it("uses SEED_DEMO_PASSWORD when set and reports fromEnv (no tip printed)", () => {
      const generate = () => {
        throw new Error("generator must not run when the env value is set");
      };
      expect(resolveDemoPassword("hunter2hunter2", generate)).toEqual({
        password: "hunter2hunter2",
        fromEnv: true,
      });
    });

    it("generates a password when the env var is unset and reports !fromEnv", () => {
      expect(resolveDemoPassword(undefined, () => "generated-hex")).toEqual({
        password: "generated-hex",
        fromEnv: false,
      });
    });

    it("pins the empty-string edge: password stays empty (??), tip still prints (falsy)", () => {
      // Mirrors main()'s exact operators — `??` for the password source but a
      // truthiness check for the tip. Changing either side is a behavior
      // change to the seed login and must be deliberate.
      expect(resolveDemoPassword("", () => "generated-hex")).toEqual({
        password: "",
        fromEnv: false,
      });
    });
  });
});
