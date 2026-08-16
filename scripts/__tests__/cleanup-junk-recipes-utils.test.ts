import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { PgDialect } from "drizzle-orm/pg-core";
import { eq, ilike, isNull, or, sql as drizzleSql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { communityRecipes } from "../../shared/schema";
import {
  buildJunkCommunityRecipeWhere,
  parseCleanupFlags,
} from "../cleanup-junk-recipes-utils";

/**
 * cleanup-junk-recipes deletes community recipes scoped to orphan
 * (authorId IS NULL) or demo-authored rows, mirroring
 * `server/scripts/cleanup-seed-recipes-utils.ts`'s `authorIdCondition`.
 * These tests render the real Drizzle predicate to SQL and pin both the
 * three OR junk-criteria branches and the author-scope conjunct.
 */

const DEMO_ID = "demo-user-42";

function render(where: SQL | undefined) {
  if (!where) throw new Error("expected SQL");
  return new PgDialect().sqlToQuery(where);
}

describe("cleanup-junk-recipes-utils", () => {
  describe("buildJunkCommunityRecipeWhere — the deletion perimeter", () => {
    it("with a demo user: scopes to orphan OR demo-authored, ANDed with the junk criteria", () => {
      const q = render(buildJunkCommunityRecipeWhere(DEMO_ID));
      const sql = q.sql.toLowerCase();
      expect(sql).toContain('"author_id" is null');
      expect(sql).toContain("ilike");
      expect(sql).toContain("length(trim(");
      expect(sql).toContain("jsonb_array_length");
      expect(q.params).toContain(DEMO_ID);
      // The author scope must be a conjunct of the whole clause, not one arm
      // of the junk-criteria OR — the and() wrapper renders as
      // (author...) and (criteria...). This is the assertion that catches a
      // regression flattening and(authorCond, or(a,b,c)) into
      // or(authorCond, a, b, c), which would silently re-open the perimeter
      // to every user.
      expect(sql).toMatch(/\(.*author_id.*\)\s+and\s+\(/);
    });

    it("without a demo user: bare orphan scope, demo id absent from params", () => {
      const q = render(buildJunkCommunityRecipeWhere(null));
      const sql = q.sql.toLowerCase();
      expect(sql).toContain('"author_id" is null');
      expect(q.params).not.toContain(DEMO_ID);
      // Table-qualified on purpose — see the mealplan sibling's rationale.
      expect(sql).toContain('"community_recipes"."title"');
      expect(sql).toContain('"community_recipes"."instructions"');
      expect(sql).toContain('"community_recipes"."ingredients"');
      // Same conjunct-structure guarantee as the demo-id case above, but
      // isNull() renders unparenthesized (no leading "(" before "is null"),
      // so the correct shape is `"author_id" is null and (...)`, not the
      // `(...) and (...)` form the demo-id branch uses. Without this, a
      // regression flattening and(isNull(authorId), or(a,b,c)) into
      // or(isNull(authorId), a, b, c) — re-opening deletion to every user
      // whenever the demo account can't be resolved — passes every other
      // assertion in this file unchanged.
      expect(sql).toMatch(/"author_id" is null\s+and\s+\(/);
    });

    it("REGRESSION GUARD: a flattened or(authorCond, ...criteria) must NOT satisfy either structural pin above", () => {
      // Two-sided negative control (docs/rules/harness.md: "a gate test
      // needs a two-sided negative control") — constructs the exact
      // flattened shape the structural pins above are meant to catch and
      // confirms both regexes correctly reject it.
      const flattenedWithDemo = render(
        or(
          isNull(communityRecipes.authorId),
          eq(communityRecipes.authorId, DEMO_ID),
          ilike(communityRecipes.title, "test recipe"),
          drizzleSql`LENGTH(TRIM(${communityRecipes.title})) < 3`,
        ),
      );
      expect(flattenedWithDemo.sql.toLowerCase()).not.toMatch(
        /\(.*author_id.*\)\s+and\s+\(/,
      );

      const flattenedWithoutDemo = render(
        or(
          isNull(communityRecipes.authorId),
          ilike(communityRecipes.title, "test recipe"),
          drizzleSql`LENGTH(TRIM(${communityRecipes.title})) < 3`,
        ),
      );
      expect(flattenedWithoutDemo.sql.toLowerCase()).not.toMatch(
        /"author_id" is null\s+and\s+\(/,
      );
    });

    it("PIN: the title match is the exact phrase 'test recipe' — no wildcards", () => {
      // ILIKE without % matches the WHOLE string case-insensitively. An
      // accidental '%test recipe%' would delete "My Test Recipe Deluxe".
      // With no demo user, the author conjunct contributes zero params, so
      // "test recipe" is the sole param.
      const q = render(buildJunkCommunityRecipeWhere(null));
      expect(q.params).toEqual(["test recipe"]);
    });

    it("PIN: param count — non-vacuity for both the author scope and the junk criteria", () => {
      // The author conjunct renders first: [demoUserId, "test recipe"].
      expect(render(buildJunkCommunityRecipeWhere(DEMO_ID)).params).toEqual([
        DEMO_ID,
        "test recipe",
      ]);
      expect(render(buildJunkCommunityRecipeWhere(null)).params).toEqual([
        "test recipe",
      ]);
    });

    it("PIN: empty-instructions and empty-ingredients are ANDed, not ORed", () => {
      // A recipe with instructions but no ingredients yet (a draft) must NOT
      // match the emptiness branch — both sides must be empty.
      const q = render(buildJunkCommunityRecipeWhere(null));
      expect(q.sql.toLowerCase()).toMatch(
        /jsonb_array_length\([^)]*instructions[^)]*\), 0\) = 0 and coalesce\(jsonb_array_length\([^)]*ingredients/,
      );
    });

    it("renders deterministically (same SQL for the same input)", () => {
      expect(render(buildJunkCommunityRecipeWhere(DEMO_ID))).toEqual(
        render(buildJunkCommunityRecipeWhere(DEMO_ID)),
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
      expect(r.stderr).toBe("");
      expect(r.status).toBe(0);
    });
  });
});
