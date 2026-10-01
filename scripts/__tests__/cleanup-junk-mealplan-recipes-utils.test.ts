import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import {
  JUNK_TITLES,
  buildJunkMealplanTitleWhere,
  parseCleanupFlags,
} from "../cleanup-junk-mealplan-recipes-utils";
import { main } from "../cleanup-junk-mealplan-recipes";
import { db } from "../../server/db";
import { savedItems, cookbookRecipes } from "../../shared/schema";

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

// This script calls `process.exit(0)` directly on BOTH the early-exit path
// (dry-run, or no junk found) and the success path (after the delete
// transaction) — mirrors the sibling `cleanup-junk-recipes-utils.test.ts`.
class ProcessExitSignal extends Error {
  constructor(public code?: string | number | null) {
    super(`process.exit(${code})`);
  }
}

const { deletes } = vi.hoisted(() => ({
  deletes: [] as { table: unknown; where: unknown }[],
}));

vi.mock("../../server/db", () => {
  const FIXTURE_ROW = { id: 1, title: "Meal 1", count: 0 };
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: vi.fn(() => chain),
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    delete: vi.fn((table: unknown) => {
      const rec: { table: unknown; where: unknown } = {
        table,
        where: undefined,
      };
      deletes.push(rec);
      const sub: Record<string, unknown> = {};
      Object.assign(sub, {
        where: vi.fn((w: unknown) => {
          rec.where = w;
          return sub;
        }),
        then: (resolve: (v: unknown) => void) => resolve([FIXTURE_ROW]),
      });
      return sub;
    }),
    then: (resolve: (v: unknown) => void) => resolve([FIXTURE_ROW]),
  });
  return {
    db: {
      select: vi.fn(() => chain),
      transaction: vi.fn((cb: (tx: unknown) => Promise<unknown>) =>
        Promise.resolve(cb(chain)),
      ),
    },
  };
});

const mockDb = db as unknown as {
  select: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
};

function emptySelectChain(): Record<string, unknown> {
  const c: Record<string, unknown> = {};
  Object.assign(c, {
    from: vi.fn(() => c),
    where: vi.fn(() => c),
    then: (resolve: (v: unknown) => void) => resolve([]),
  });
  return c;
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

  describe("cleanup-junk-mealplan-recipes main() — the real commit gate (mocked db)", () => {
    let exitSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      vi.clearAllMocks();
      deletes.length = 0;
      exitSpy = vi
        .spyOn(process, "exit")
        .mockImplementation((code?: string | number | null): never => {
          throw new ProcessExitSignal(code);
        });
    });

    afterEach(() => {
      exitSpy.mockRestore();
    });

    it("a bare invocation does NOT reach db.transaction (must never delete)", async () => {
      const err: unknown = await main(["node", "s"]).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ProcessExitSignal);
      expect(err).toMatchObject({ code: 0 });
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it("--commit DOES reach db.transaction (arms the delete)", async () => {
      const err: unknown = await main(["node", "s", "--commit"]).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(ProcessExitSignal);
      expect(err).toMatchObject({ code: 0 });
      expect(mockDb.transaction).toHaveBeenCalled();
    });

    it("--commit --dry-run does NOT reach db.transaction (--dry-run vetoes)", async () => {
      const err: unknown = await main([
        "node",
        "s",
        "--commit",
        "--dry-run",
      ]).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ProcessExitSignal);
      expect(err).toMatchObject({ code: 0 });
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it("--commit with ZERO junk recipes found does NOT reach db.transaction", async () => {
      mockDb.select.mockImplementationOnce(() => emptySelectChain());

      const err: unknown = await main(["node", "s", "--commit"]).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(ProcessExitSignal);
      expect(err).toMatchObject({ code: 0 });
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it("--commit deletes saved_items rows scoped to (recipeType='mealPlan', recipeId=<deleted ids>)", async () => {
      const err: unknown = await main(["node", "s", "--commit"]).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(ProcessExitSignal);
      const rec = deletes.find((d) => d.table === savedItems);
      expect(rec).toBeDefined();
      const q = render(rec!.where as SQL);
      expect(q.sql).toContain(String.raw`"saved_items"."recipe_id"`);
      expect(q.sql).toContain(String.raw`"saved_items"."recipe_type"`);
      expect(q.params).toContain("mealPlan");
      expect(q.params).toContain(1);
    });

    it("--commit scopes the cookbookRecipes cleanup by recipeType='mealPlan' (regression pin for the mismatched 'meal_plan' literal)", async () => {
      const err: unknown = await main(["node", "s", "--commit"]).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(ProcessExitSignal);
      const rec = deletes.find((d) => d.table === cookbookRecipes);
      expect(rec).toBeDefined();
      const q = render(rec!.where as SQL);
      expect(q.params).toContain("mealPlan");
      expect(q.params).not.toContain("meal_plan");
    });
  });

  describe("cleanup-junk-mealplan-recipes banner — wiring seam (spawnSync, no DB)", () => {
    const ROOT = join(__dirname, "..", "..");
    const scriptPath = join(
      ROOT,
      "scripts",
      "cleanup-junk-mealplan-recipes.ts",
    );
    const env = {
      ...process.env,
      DATABASE_URL: "postgresql://t:t@127.0.0.1:1/nope",
    };

    function run(...flags: string[]) {
      return spawnSync(
        process.execPath,
        ["--import=tsx", scriptPath, ...flags],
        { encoding: "utf8", timeout: 10_000, cwd: ROOT, env },
      );
    }

    it("bare invocation prints === DRY RUN ===", () => {
      const r = run();
      expect(r.stdout).toContain("=== DRY RUN ===  (pass --commit to delete)");
    });

    it("--commit prints === LIVE RUN ===", () => {
      const r = run("--commit");
      expect(r.stdout).toContain("=== LIVE RUN ===");
    });

    it("--commit --dry-run prints === DRY RUN === and NAMES --dry-run as the veto", () => {
      const r = run("--commit", "--dry-run");
      expect(r.stdout).toContain(
        "=== DRY RUN ===  (--dry-run overrides --commit; drop --dry-run to delete)",
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
