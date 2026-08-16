import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import {
  buildJunkCommunityRecipeWhere,
  parseCleanupFlags,
} from "../cleanup-junk-recipes-utils";

/**
 * cleanup-junk-recipes deletes community recipes across ALL users (no author
 * scoping — surfaced as a follow-up, not changed here). These tests render
 * the real Drizzle predicate to SQL and pin its three OR branches.
 */

function render(where: SQL | undefined) {
  if (!where) throw new Error("expected SQL");
  return new PgDialect().sqlToQuery(where);
}

describe("cleanup-junk-recipes-utils", () => {
  describe("buildJunkCommunityRecipeWhere — the deletion perimeter", () => {
    it("ORs the three junk criteria over title/instructions/ingredients", () => {
      const q = render(buildJunkCommunityRecipeWhere());
      const sql = q.sql.toLowerCase();
      expect(sql).toContain("ilike");
      expect(sql).toContain("length(trim(");
      expect(sql).toContain("jsonb_array_length");
      // Table-qualified on purpose — see the mealplan sibling's rationale.
      expect(sql).toContain('"community_recipes"."title"');
      expect(sql).toContain('"community_recipes"."instructions"');
      expect(sql).toContain('"community_recipes"."ingredients"');
    });

    it("PIN: the title match is the exact phrase 'test recipe' — no wildcards", () => {
      // ILIKE without % matches the WHOLE string case-insensitively. An
      // accidental '%test recipe%' would delete "My Test Recipe Deluxe".
      const q = render(buildJunkCommunityRecipeWhere());
      expect(q.params).toEqual(["test recipe"]);
    });

    it("PIN: empty-instructions and empty-ingredients are ANDed, not ORed", () => {
      // A recipe with instructions but no ingredients yet (a draft) must NOT
      // match the emptiness branch — both sides must be empty.
      const q = render(buildJunkCommunityRecipeWhere());
      expect(q.sql.toLowerCase()).toMatch(
        /jsonb_array_length\([^)]*instructions[^)]*\), 0\) = 0 and coalesce\(jsonb_array_length\([^)]*ingredients/,
      );
    });

    it("renders deterministically", () => {
      expect(render(buildJunkCommunityRecipeWhere())).toEqual(
        render(buildJunkCommunityRecipeWhere()),
      );
    });
  });

  describe("parseCleanupFlags — dry-run by default", () => {
    it("defaults to commit: false (a bare run must PREVIEW, never delete)", () => {
      expect(parseCleanupFlags(["node", "script.ts"])).toEqual({
        commit: false,
        vetoed: false,
      });
    });

    it("arms deletion only on an explicit --commit", () => {
      expect(parseCleanupFlags(["node", "s", "--commit"])).toEqual({
        commit: true,
        vetoed: false,
      });
    });

    it("accepts legacy --dry-run as a harmless no-op alias (nothing vetoed)", () => {
      expect(parseCleanupFlags(["node", "s", "--dry-run"])).toEqual({
        commit: false,
        vetoed: false,
      });
    });

    it("--dry-run WINS over --commit in either order — and REPORTS the veto", () => {
      expect(parseCleanupFlags(["node", "s", "--commit", "--dry-run"])).toEqual(
        { commit: false, vetoed: true },
      );
      expect(parseCleanupFlags(["node", "s", "--dry-run", "--commit"])).toEqual(
        { commit: false, vetoed: true },
      );
    });
  });

  describe("module import graph", () => {
    it("is importable without DATABASE_URL (stays db-free)", () => {
      const ROOT = join(__dirname, "..", "..");
      const utilsPath = join(ROOT, "scripts", "cleanup-junk-recipes-utils.ts");
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
