import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import {
  JUNK_TITLES,
  buildJunkMealplanTitleWhere,
  parseCleanupFlags,
} from "../cleanup-junk-mealplan-recipes-utils";

/**
 * cleanup-junk-mealplan-recipes deletes by EXACT title match across ALL users
 * with no author scoping, and its JUNK_TITLES list contains titles real users
 * plausibly type ("Simple Meal", "Chicken Rice", "Meal 1"). That makes its
 * predicate the highest-risk deletion perimeter in scripts/ — these tests
 * render the real Drizzle SQL and pin it.
 */

function render(where: SQL | undefined) {
  if (!where) throw new Error("expected SQL");
  return new PgDialect().sqlToQuery(where);
}

describe("cleanup-junk-mealplan-recipes-utils", () => {
  describe("buildJunkMealplanTitleWhere — the deletion perimeter", () => {
    it("targets meal_plan_recipes.title with an IN over exactly the junk list", () => {
      const q = render(buildJunkMealplanTitleWhere());
      // Table-qualified on purpose: the two cleanup leaves are structurally
      // near-identical, so a copy-paste of the wrong table's column would
      // pass a bare `"title"` check silently.
      expect(q.sql.toLowerCase()).toContain('"meal_plan_recipes"."title" in (');
      expect(q.params).toEqual(JUNK_TITLES);
    });

    it("PIN: exact match only — no ILIKE, no wildcards", () => {
      // "Improving" this into a pattern match would sweep in every title
      // CONTAINING "Meal 1" etc. Deletion stays exact-match by design.
      const q = render(buildJunkMealplanTitleWhere());
      expect(q.sql.toLowerCase()).not.toContain("ilike");
      for (const p of q.params) {
        expect(String(p)).not.toContain("%");
      }
    });

    it("non-vacuity: the junk list still has its 10 entries", () => {
      // A silently emptied JUNK_TITLES renders `IN ()` — found nothing,
      // deleted nothing, and the script reports success.
      expect(JUNK_TITLES).toHaveLength(10);
      expect(render(buildJunkMealplanTitleWhere()).params).toHaveLength(10);
    });
  });

  describe("parseCleanupFlags — dry-run by default", () => {
    it("defaults to commit: false (a bare run must PREVIEW, never delete)", () => {
      // Regression-by-design: the script used to LIVE-delete by default with
      // opt-in --dry-run — the inverse of the repo's own cleanup-seed-recipes
      // safety pattern. A bare invocation now previews.
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
      // Stale invocations from old runbooks must keep previewing.
      expect(parseCleanupFlags(["node", "s", "--dry-run"])).toEqual({
        commit: false,
        vetoed: false,
      });
    });

    it("--dry-run WINS over --commit in either order — and REPORTS the veto", () => {
      // An operator keeping a habitual --dry-run in a saved command while
      // adding --commit plausibly believes the safety flag still protects
      // them. Both flags together must preview, never delete — and `vetoed`
      // lets the script's banner NAME --dry-run as the reason, instead of
      // telling the operator to pass the --commit they already passed.
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
      const utilsPath = join(
        ROOT,
        "scripts",
        "cleanup-junk-mealplan-recipes-utils.ts",
      );
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
