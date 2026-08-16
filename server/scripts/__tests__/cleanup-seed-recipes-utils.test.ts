import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import {
  buildJunkRecipeWhere,
  parseArgs,
  LEGACY_TEST_PRODUCT_NAMES,
  SEED_PREFIX,
  TEST_PREFIX,
} from "../cleanup-seed-recipes-utils";

/**
 * The cleanup script's WHERE clause is the security perimeter for
 * `npm run cleanup:seeds` — mis-matching it deletes real user data. These
 * tests render the REAL Drizzle predicate the script executes
 * (`buildJunkRecipeWhere`) to SQL and assert on it directly. The previous
 * suite tested `isJunkRecipeName`, a TypeScript reimplementation the script
 * never called: an unanchored ILIKE or a dropped authorId scope stayed green
 * there. Deleted in favor of the real thing.
 */

function render(where: SQL | undefined) {
  if (!where) throw new Error("expected buildJunkRecipeWhere to return SQL");
  return new PgDialect().sqlToQuery(where);
}

const stringParams = (q: { params: unknown[] }): string[] =>
  q.params.filter((p): p is string => typeof p === "string");

describe("cleanup-seed-recipes-utils", () => {
  describe("buildJunkRecipeWhere — the deletion perimeter", () => {
    it("with a demo user: scopes to orphan OR demo-authored, ANDed with the name match", () => {
      const q = render(buildJunkRecipeWhere("demo-user-42"));
      const sql = q.sql.toLowerCase();
      expect(sql).toContain('"author_id" is null');
      expect(sql).toContain("or");
      expect(sql).toContain('"normalized_product_name"');
      expect(sql).toContain("ilike");
      expect(q.params).toContain("demo-user-42");
      // The author scope must be a conjunct of the whole clause, not one arm
      // of the name OR — the and() wrapper renders as (author...) and (names...).
      expect(sql).toMatch(/\(.*author_id.*\)\s+and\s+\(/);
    });

    it("without a demo user: bare orphan scope, demo id absent from params", () => {
      const q = render(buildJunkRecipeWhere(null));
      expect(q.sql.toLowerCase()).toContain('"author_id" is null');
      expect(q.params).not.toContain("demo-user-42");
      expect(q.params.length).toBe(5); // 2 prefixes + 3 legacy names, no id
    });

    it("REGRESSION GUARD: prefixes are start-anchored ('seed-%', never '%seed-%')", () => {
      // This is the exact regression the old lookalike test could not catch:
      // an accidental '%seed-%' matches "birdseed-bread" and starts deleting
      // real user recipes. No pattern param may begin with a wildcard.
      const q = render(buildJunkRecipeWhere("demo-user-42"));
      const patterns = stringParams(q).filter((p) => p.includes("%"));
      expect(patterns).toContain(`${SEED_PREFIX}%`);
      expect(patterns).toContain(`${TEST_PREFIX}%`);
      for (const p of patterns) {
        expect(p.startsWith("%")).toBe(false);
      }
    });

    it("carries every legacy back-compat name", () => {
      const q = render(buildJunkRecipeWhere(null));
      for (const name of LEGACY_TEST_PRODUCT_NAMES) {
        expect(q.params).toContain(name);
      }
      // Non-vacuity for the whole clause: exactly the expected param count,
      // so a silently emptied legacy list or dropped ILIKE turns this red.
      expect(q.params.length).toBe(2 + LEGACY_TEST_PRODUCT_NAMES.length);
    });

    it("renders deterministically (same SQL for the same input)", () => {
      expect(render(buildJunkRecipeWhere("demo-user-7"))).toEqual(
        render(buildJunkRecipeWhere("demo-user-7")),
      );
    });
  });

  describe("parseArgs — dry-run by default", () => {
    it("defaults to commit: false (a bare run must never delete)", () => {
      expect(parseArgs([])).toEqual({ commit: false });
      expect(parseArgs(["--verbose"])).toEqual({ commit: false });
    });

    it("arms deletion only on an explicit --commit", () => {
      expect(parseArgs(["--commit"])).toEqual({ commit: true });
    });
  });

  describe("legacy allowlist hygiene", () => {
    it("only contains lowercase entries (case-insensitive comparison assumes lowercase keys)", () => {
      for (const name of LEGACY_TEST_PRODUCT_NAMES) {
        expect(name).toBe(name.toLowerCase());
      }
    });

    it("does not double-cover anything that would already match the test- prefix", () => {
      // If someone backfills the legacy list with `test-foo`, both branches
      // would fire — harmless but wasteful. Catch it in CI.
      for (const name of LEGACY_TEST_PRODUCT_NAMES) {
        expect(name.startsWith(TEST_PREFIX)).toBe(false);
        expect(name.startsWith(SEED_PREFIX)).toBe(false);
      }
    });
  });

  describe("module import graph", () => {
    it("is importable without DATABASE_URL (stays db-free)", () => {
      // buildJunkRecipeWhere pulls in drizzle-orm and @shared/schema — neither
      // may drag in server/db.ts, which throws at module load when
      // DATABASE_URL is unset. If this fails, an import crossed into the
      // storage/db graph (db-free leaf policy, see barcode-policy.test.ts).
      const ROOT = join(__dirname, "..", "..", "..");
      const utilsPath = join(
        ROOT,
        "server",
        "scripts",
        "cleanup-seed-recipes-utils.ts",
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
      expect(r.stderr).toBe("");
      expect(r.status).toBe(0);
    });
  });
});
