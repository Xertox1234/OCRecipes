import { describe, it, expect } from "vitest";
import {
  parseBackfillFlags,
  evaluateBackfillGuard,
} from "../backfill-recipe-images-utils";

describe("backfill-recipe-images-utils", () => {
  describe("evaluateBackfillGuard — the spend guard", () => {
    it("REFUSES a live run without Runware configured, naming the missing key", () => {
      const decision = evaluateBackfillGuard({
        dryRun: false,
        bumpOnly: false,
        runwareConfigured: false,
      });
      expect(decision.ok).toBe(false);
      if (decision.ok) return;
      expect(decision.reason).toContain("RUNWARE_API_KEY not set");
    });

    it("allows --dry-run and --bump-version-only without the key (no spend paths)", () => {
      expect(
        evaluateBackfillGuard({
          dryRun: true,
          bumpOnly: false,
          runwareConfigured: false,
        }).ok,
      ).toBe(true);
      expect(
        evaluateBackfillGuard({
          dryRun: false,
          bumpOnly: true,
          runwareConfigured: false,
        }).ok,
      ).toBe(true);
    });

    it("allows a live run when Runware is configured (non-vacuity control)", () => {
      expect(
        evaluateBackfillGuard({
          dryRun: false,
          bumpOnly: false,
          runwareConfigured: true,
        }).ok,
      ).toBe(true);
    });
  });

  describe("parseBackfillFlags", () => {
    it("defaults: no flags → live mode, no limit", () => {
      expect(parseBackfillFlags(["node", "script.ts"])).toEqual({
        dryRun: false,
        includeCanonical: false,
        bumpOnly: false,
        fillMissing: false,
        limit: Infinity,
      });
    });

    it("parses every boolean flag", () => {
      const flags = parseBackfillFlags([
        "node",
        "script.ts",
        "--dry-run",
        "--include-canonical",
        "--bump-version-only",
        "--fill-missing",
      ]);
      expect(flags.dryRun).toBe(true);
      expect(flags.includeCanonical).toBe(true);
      expect(flags.bumpOnly).toBe(true);
      expect(flags.fillMissing).toBe(true);
    });

    it("parses a numeric --limit", () => {
      expect(parseBackfillFlags(["node", "s", "--limit", "5"]).limit).toBe(5);
    });

    it("REJECTS a non-numeric --limit instead of silently disabling the cap", () => {
      // Regression: `--limit five` parsed to NaN, and every NaN comparison is
      // false — so the cap silently never engaged on a script that spends
      // real money per image. A typo'd limit must refuse, not run unbounded.
      expect(() =>
        parseBackfillFlags(["node", "s", "--limit", "five"]),
      ).toThrow(/--limit requires a positive integer/);
      expect(() => parseBackfillFlags(["node", "s", "--limit"])).toThrow(
        /--limit requires a positive integer/,
      );
      expect(() => parseBackfillFlags(["node", "s", "--limit", "0"])).toThrow(
        /--limit requires a positive integer/,
      );
    });
  });
});
