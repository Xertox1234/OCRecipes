import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { PgDialect } from "drizzle-orm/pg-core";
import { and, eq, ilike, isNull, or, sql as drizzleSql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { communityRecipes } from "../../shared/schema";
import {
  buildJunkCommunityRecipeWhere,
  parseCleanupFlags,
} from "../cleanup-junk-recipes-utils";
import { main } from "../cleanup-junk-recipes";
import { db } from "../../server/db";

// Deliberately generic — this mock proves the COMMIT GATE discriminates, not
// the deletion perimeter (that SQL is pinned separately above by
// `buildJunkCommunityRecipeWhere`'s own tests).
vi.mock("../../server/db", () => {
  // One fixture row, resolved by every terminal DB call. Defined INSIDE the
  // factory: vi.mock factories are hoisted above module-scope const
  // declarations, so an outer-scope reference here would run before it is
  // initialized.
  const FIXTURE_ROW = { id: 1, title: "Fixture Junk Recipe", authorId: null };
  // A single flat object that is BOTH chainable (every builder method
  // returns the same object) AND thenable (awaiting it resolves the
  // fixture) — stands in for a Drizzle query/transaction builder.
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: vi.fn(() => chain),
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    then: (resolve: (v: unknown) => void) => resolve([FIXTURE_ROW]),
  });
  return {
    db: {
      select: vi.fn(() => chain),
      // The real write gate: `main()` only reaches this on --commit. The
      // callback receives the same chainable `tx`, so every `tx.delete(...)`
      // inside it resolves too.
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

/** A chainable/thenable stand-in resolving to an EMPTY result set — for
 * overriding one `db.select(...)` call via `mockImplementationOnce`. */
function emptySelectChain(): Record<string, unknown> {
  const c: Record<string, unknown> = {};
  Object.assign(c, {
    from: vi.fn(() => c),
    where: vi.fn(() => c),
    then: (resolve: (v: unknown) => void) => resolve([]),
  });
  return c;
}

// This script calls `process.exit(0)` directly on BOTH the early-exit path
// (dry-run, or no junk found) and the success path (after the delete
// transaction) — with no `return` after either call. A no-op mock would let
// execution fall through past the early-exit branch into the transaction
// code, silently breaking the very discrimination this suite exists to
// prove. Throwing instead reproduces the "nothing after this point runs"
// property of a real exit, and lets the test catch it and assert what ran
// (or didn't) BEFORE the throw.
class ProcessExitSignal extends Error {
  constructor(public code?: string | number | null) {
    super(`process.exit(${code})`);
  }
}

/**
 * cleanup-junk-recipes permanently DELETES community recipes, scoped to orphan
 * (authorId IS NULL) or demo-authored rows, mirroring
 * `server/scripts/cleanup-seed-recipes-utils.ts`'s `authorIdCondition`.
 * These tests render the real Drizzle predicate with `PgDialect().sqlToQuery()`
 * and pin the WHOLE rendered string for both branches of the `demoUserId`
 * ternary.
 */

const DEMO_ID = "demo-user-42";

function render(where: SQL | undefined) {
  if (!where) throw new Error("expected SQL");
  return new PgDialect().sqlToQuery(where);
}

/**
 * The EXACT rendered SQL of the deletion perimeter — inline literals, on
 * purpose, for a statement that permanently deletes rows:
 *
 *  - NOT a structural regex. A loose shape check such as
 *    `/\(.*author_id.*\)\s+and\s+\(/` observes only that SOME author-scoped
 *    conjunct exists somewhere in the string. It is satisfied by a PARTIAL
 *    escape — `or(and(authorCond, or(a, b)), c)`, one junk criterion hoisted
 *    OUT of the author scope — which would delete any user's matching recipe,
 *    and which leaves the param list byte-identical so the param pins below
 *    can't catch it either. The REGRESSION GUARD test constructs exactly that
 *    shape and proves it.
 *  - NOT `toMatchSnapshot()`. A snapshot gets re-blessed by `vitest -u`
 *    without anyone reading the diff — the quiet-disarm failure mode this
 *    perimeter can least afford.
 *
 * Table-qualification (`"community_recipes"."title"`, deliberate — see the
 * mealplan sibling's rationale) and the `ILIKE`-without-wildcards phrasing are
 * both inside the pin.
 *
 * Trade-off, accepted knowingly: an exact pin also goes red on a
 * semantically-equivalent conjunct REORDER. For a permanent-DELETE perimeter
 * that is the correct trade, not a defect — re-render the predicate, read the
 * new SQL, and update the literal deliberately.
 */
const EXPECTED_SQL_WITH_DEMO =
  '(("community_recipes"."author_id" is null or "community_recipes"."author_id" = $1) and ("community_recipes"."title" ilike $2 or LENGTH(TRIM("community_recipes"."title")) < 3 or (COALESCE(jsonb_array_length("community_recipes"."instructions"), 0) = 0 and COALESCE(jsonb_array_length("community_recipes"."ingredients"), 0) = 0)))';
const EXPECTED_SQL_ORPHAN_ONLY =
  '("community_recipes"."author_id" is null and ("community_recipes"."title" ilike $1 or LENGTH(TRIM("community_recipes"."title")) < 3 or (COALESCE(jsonb_array_length("community_recipes"."instructions"), 0) = 0 and COALESCE(jsonb_array_length("community_recipes"."ingredients"), 0) = 0)))';

/**
 * The three junk criteria, faithful to the source — INCLUDING the `and()`
 * emptiness branch, which is the only construct in the real predicate that
 * contributes an `and` to the rendered string. A negative-control fixture that
 * drops it is not exercising the shape these pins have to discriminate.
 */
const junkCriteria = () =>
  [
    ilike(communityRecipes.title, "test recipe"),
    drizzleSql`LENGTH(TRIM(${communityRecipes.title})) < 3`,
    and(
      drizzleSql`COALESCE(jsonb_array_length(${communityRecipes.instructions}), 0) = 0`,
      drizzleSql`COALESCE(jsonb_array_length(${communityRecipes.ingredients}), 0) = 0`,
    ),
  ] as const;

const authorScopeWithDemo = () =>
  or(isNull(communityRecipes.authorId), eq(communityRecipes.authorId, DEMO_ID));

/** `or(and(authorCond, or(ilike, emptiness)), shortTitle)` — the `< 3` branch
 *  hoisted OUTSIDE the author scope. */
function partialEscape(authorScope: SQL | undefined) {
  const [ilikeCriterion, shortTitle, emptiness] = junkCriteria();
  return render(
    or(and(authorScope, or(ilikeCriterion, emptiness)), shortTitle),
  );
}

describe("cleanup-junk-recipes-utils", () => {
  describe("buildJunkCommunityRecipeWhere — the deletion perimeter", () => {
    it("with a demo user: renders EXACTLY the orphan-OR-demo scope ANDed with the junk criteria", () => {
      const q = render(buildJunkCommunityRecipeWhere(DEMO_ID));
      expect(q.sql).toBe(EXPECTED_SQL_WITH_DEMO);
      expect(q.params).toContain(DEMO_ID);
    });

    it("without a demo user: renders EXACTLY the bare orphan scope, demo id absent from params", () => {
      // The `null` branch is the one silently reached whenever the demo-user
      // lookup fails to resolve — it degrades to the NARROWER orphan-only
      // scope, and `isNull()` renders unparenthesized, so it is a genuinely
      // different SQL shape that needs its own pin.
      const q = render(buildJunkCommunityRecipeWhere(null));
      expect(q.sql).toBe(EXPECTED_SQL_ORPHAN_ONLY);
      expect(q.params).not.toContain(DEMO_ID);
    });

    it("REGRESSION GUARD: neither a flattened NOR a partial author-scope escape satisfies the exact pins", () => {
      // Two-sided negative control (docs/rules/harness.md: "a gate test needs
      // a two-sided negative control"). Each fixture is built from
      // `junkCriteria()` so it stays faithful to the real predicate.

      // (a) Fully flattened: or(authorCond, ...criteria) — deletion re-opened
      // to every user. The loose regexes this pin replaced DID catch this one.
      const flattenedWithDemo = render(
        or(authorScopeWithDemo(), ...junkCriteria()),
      );
      expect(flattenedWithDemo.sql).not.toBe(EXPECTED_SQL_WITH_DEMO);
      expect(flattenedWithDemo.sql.toLowerCase()).not.toMatch(
        /\(.*author_id.*\)\s+and\s+\(/,
      );

      const flattenedOrphanOnly = render(
        or(isNull(communityRecipes.authorId), ...junkCriteria()),
      );
      expect(flattenedOrphanOnly.sql).not.toBe(EXPECTED_SQL_ORPHAN_ONLY);
      expect(flattenedOrphanOnly.sql.toLowerCase()).not.toMatch(
        /"author_id" is null\s+and\s+\(/,
      );

      // (b) PARTIAL escape: only the `LENGTH(TRIM(title)) < 3` branch hoisted
      // out of the author scope — enough to delete ANY user's recipe with a
      // trimmed title under 3 chars. This is why the pin is an exact string:
      // the fixture still SATISFIES the old loose regexes (asserted below) and
      // its param list is byte-identical to the correct predicate's, so every
      // structural and param assertion in this file passed it unchanged.
      const partialWithDemo = partialEscape(authorScopeWithDemo());
      expect(partialWithDemo.sql).not.toBe(EXPECTED_SQL_WITH_DEMO);
      expect(partialWithDemo.sql.toLowerCase()).toMatch(
        /\(.*author_id.*\)\s+and\s+\(/,
      );
      expect(partialWithDemo.params).toEqual([DEMO_ID, "test recipe"]);

      const partialOrphanOnly = partialEscape(
        isNull(communityRecipes.authorId),
      );
      expect(partialOrphanOnly.sql).not.toBe(EXPECTED_SQL_ORPHAN_ONLY);
      expect(partialOrphanOnly.sql.toLowerCase()).toMatch(
        /"author_id" is null\s+and\s+\(/,
      );
      expect(partialOrphanOnly.params).toEqual(["test recipe"]);
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

  describe("cleanup-junk-recipes main() — the real commit gate (mocked db)", () => {
    // The banner text (asserted below via spawnSync against an unreachable
    // DB) sits BEFORE an unconditional `users` select; the actual
    // `if (!COMMIT || junkRecipes.length === 0)` gate sits AFTER it. No
    // no-DB spawnSync test can ever reach that gate — this suite mocks `db`
    // so `main()` runs the real script logic in-process, with one fixture
    // row, and asserts on the ONE thing that gate actually controls: whether
    // `db.transaction` is invoked at all.
    let exitSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      vi.clearAllMocks();
      exitSpy = vi
        .spyOn(process, "exit")
        .mockImplementation((code?: string | number | null): never => {
          throw new ProcessExitSignal(code);
        });
    });

    afterEach(() => {
      exitSpy.mockRestore();
    });

    // `process.exit(0)` fires from BOTH the early-exit branch (line ~89) and
    // the post-transaction success branch (line ~125) — the throw alone
    // doesn't distinguish which; the exit code doesn't either (both branches
    // exit 0). Assert BOTH that it's genuinely our spy's signal (not some
    // other rejection) AND the exit code, then let the `db.transaction`
    // assertion below do the real discriminating.
    it("a bare invocation does NOT reach db.transaction (must never delete)", async () => {
      const err: unknown = await main([]).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ProcessExitSignal);
      expect(err).toMatchObject({ code: 0 });
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it("--commit DOES reach db.transaction (arms the delete)", async () => {
      const err: unknown = await main(["--commit"]).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ProcessExitSignal);
      expect(err).toMatchObject({ code: 0 });
      expect(mockDb.transaction).toHaveBeenCalled();
    });

    it("--commit --dry-run does NOT reach db.transaction (--dry-run vetoes)", async () => {
      const err: unknown = await main(["--commit", "--dry-run"]).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(ProcessExitSignal);
      expect(err).toMatchObject({ code: 0 });
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    // The real gate is compound (`!COMMIT || junkRecipes.length === 0`) —
    // the tests above only vary the COMMIT axis (fixture always returns one
    // row). This covers the other axis: --commit with a genuinely empty
    // result set must ALSO never reach db.transaction.
    it("--commit with ZERO junk recipes found does NOT reach db.transaction", async () => {
      mockDb.select
        .mockImplementationOnce(() => emptySelectChain()) // users lookup
        .mockImplementationOnce(() => emptySelectChain()); // junk query -> empty

      const err: unknown = await main(["--commit"]).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ProcessExitSignal);
      expect(err).toMatchObject({ code: 0 });
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });
  });

  describe("cleanup-junk-recipes banner — wiring seam (spawnSync, no DB)", () => {
    // What this DOES prove: the real script correctly wires argv ->
    // parseCleanupFlags -> the printed banner. What it does NOT prove: that
    // the `if (!COMMIT || ...)` write gate itself is correct — see the
    // mocked-db suite above, which owns that guarantee.
    //
    // DATABASE_URL is set to a syntactically-valid but UNREACHABLE address
    // (never deleted, unlike the db-free import-pin below) — `server/db.ts`
    // throws synchronously at import if DATABASE_URL is unset, which would
    // crash before the banner ever prints. `pg`'s Pool connects lazily, so
    // the banner (printed before any query) is unaffected by the connection
    // failing a moment later.
    const ROOT = join(__dirname, "..", "..");
    const scriptPath = join(ROOT, "scripts", "cleanup-junk-recipes.ts");
    const env = {
      ...process.env,
      DATABASE_URL: "postgresql://t:t@127.0.0.1:1/nope",
    };

    function run(...flags: string[]) {
      return spawnSync(
        process.execPath,
        ["--import=tsx", scriptPath, ...flags],
        {
          encoding: "utf8",
          timeout: 10_000,
          cwd: ROOT,
          env,
        },
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
