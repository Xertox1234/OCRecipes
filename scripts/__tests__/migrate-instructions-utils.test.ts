import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  parseTextToSteps,
  evaluateRerunGuard,
} from "../migrate-instructions-utils";

describe("migrate-instructions-utils", () => {
  describe("parseTextToSteps", () => {
    it.each([
      ["1. Mix everything\n2. Bake at 350", ["Mix everything", "Bake at 350"]],
      ["1) Mix everything\n2) Bake at 350", ["Mix everything", "Bake at 350"]],
      [
        "Step 1: Mix everything\nStep 2: Bake at 350",
        ["Mix everything", "Bake at 350"],
      ],
    ])("splits numbered steps: %j", (input, expected) => {
      expect(parseTextToSteps(input)).toEqual(expected);
    });

    it("splits paragraph-style text on blank lines", () => {
      expect(parseTextToSteps("Mix everything well\n\nBake at 350")).toEqual([
        "Mix everything well",
        "Bake at 350",
      ]);
    });

    it("falls back to single newlines and strips bullet markers", () => {
      expect(parseTextToSteps("- Mix\n* Bake\n• Serve")).toEqual([
        "Mix",
        "Bake",
        "Serve",
      ]);
    });

    it("strips HTML tags before splitting (Spoonacular imports)", () => {
      expect(parseTextToSteps("<p>Mix</p>\n<p>Bake</p>")).toEqual([
        "Mix",
        "Bake",
      ]);
    });

    it("PIN: adjacent HTML paragraphs without newlines concatenate into one step", () => {
      // Tag stripping leaves no separator, so "<p>Mix</p><p>Bake</p>" becomes
      // a single blob. Known limitation, pinned as-is: the one-time migration
      // flagged single-step rows for manual review rather than guessing.
      expect(parseTextToSteps("<p>Mix</p><p>Bake</p>")).toEqual(["MixBake"]);
    });

    it("returns a single block as one step", () => {
      expect(parseTextToSteps("Mix everything and bake.")).toEqual([
        "Mix everything and bake.",
      ]);
    });

    it("PIN: a lone numbered line falls through with its prefix INTACT", () => {
      // The numbered split needs >1 result to commit; on fall-through the
      // original cleaned text (prefix included) is returned as one step.
      expect(parseTextToSteps("1. Mix everything")).toEqual([
        "1. Mix everything",
      ]);
    });

    it.each([
      ["", []] as const,
      ["   \n  ", []] as const,
      ["<div></div>", []] as const,
    ])("returns [] for empty-ish input %j", (input, expected) => {
      expect(parseTextToSteps(input)).toEqual(expected);
    });
  });

  describe("evaluateRerunGuard — protects the rollback point", () => {
    it("REFUSES a re-run when backup tables exist and no --force-rerun", () => {
      // Regression guard: the script DROPs its own backup tables first thing,
      // so a second run destroyed the only rollback while the error handler
      // still promised "Backup tables exist for rollback."
      const decision = evaluateRerunGuard({ backupsExist: true, force: false });
      expect(decision.refuse).toBe(true);
      expect(decision.reason).toContain("rollback");
      expect(decision.reason).toContain("--force-rerun");
    });

    it("allows a first run (no backups present)", () => {
      expect(evaluateRerunGuard({ backupsExist: false, force: false })).toEqual(
        { refuse: false },
      );
    });

    it("allows an explicit forced re-run (non-vacuity control)", () => {
      expect(evaluateRerunGuard({ backupsExist: true, force: true })).toEqual({
        refuse: false,
      });
    });
  });

  describe("module import graph", () => {
    it("is importable without DATABASE_URL (stays db-free)", () => {
      const ROOT = join(__dirname, "..", "..");
      const utilsPath = join(ROOT, "scripts", "migrate-instructions-utils.ts");
      const env = { ...process.env };
      delete env.DATABASE_URL;
      const r = spawnSync(
        process.execPath,
        [
          "--import=tsx",
          "--input-type=module",
          "-e",
          `await import(${JSON.stringify(utilsPath)})`,
        ],
        { encoding: "utf8", timeout: 15_000, cwd: ROOT, env },
      );
      // Status carries the invariant; stderr uses a targeted negative, never
      // exact-empty — see server/services/__tests__/barcode-policy.test.ts
      // for why.
      expect(r.status).toBe(0);
      expect(r.stderr).not.toMatch(/error|DATABASE_URL/i);
    });
  });
});
