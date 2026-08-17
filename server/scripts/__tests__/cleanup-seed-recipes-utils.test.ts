import { describe, it, expect, vi, beforeEach } from "vitest";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { PgDialect } from "drizzle-orm/pg-core";
import { and, eq, ilike, inArray, isNull, or } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { communityRecipes } from "@shared/schema";
import {
  buildJunkRecipeWhere,
  parseCleanupFlags,
  LEGACY_TEST_PRODUCT_NAMES,
  SEED_PREFIX,
  TEST_PREFIX,
} from "../cleanup-seed-recipes-utils";
import { main } from "../cleanup-seed-recipes";
import { db } from "../../db";

// Deliberately generic — this mock proves the COMMIT GATE discriminates,
// not the deletion perimeter (that SQL is pinned separately above by
// `buildJunkRecipeWhere`'s own tests).
vi.mock("../../db", () => {
  // One fixture row, resolved by every terminal DB call (select AND the
  // delete/returning tail inside a transaction). `imageUrl: null` skips the
  // real-fs image cleanup branch. Defined INSIDE the factory: vi.mock
  // factories are hoisted above module-scope const declarations, so an
  // outer-scope reference here would run before it is initialized.
  const FIXTURE_ROW = {
    // Numeric, matching `communityRecipes.id`'s real `serial` type (see
    // `shared/schema.ts`) — `main()` does `junkIds.map(String)` for
    // `recipeDismissals.recipeIdentifier`, and a string id here would make
    // that `.map(String)` a silent no-op, hiding a real coercion bug.
    id: 1,
    authorId: null,
    normalizedProductName: "test-fixture-row",
    imageUrl: null,
    count: 0,
  };
  // A single flat object that is BOTH chainable (every builder method
  // returns the same object) AND thenable (awaiting it resolves the
  // fixture) — so it stands in for a Drizzle query/transaction builder
  // regardless of whether `.where()` or `.returning()` ends the chain.
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: vi.fn(() => chain),
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    set: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    returning: vi.fn(() => chain),
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
    pool: { end: vi.fn(async () => undefined) },
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

const DEMO_ID = "demo-user-42";

/**
 * The EXACT rendered SQL of the demo-user branch — inline literal, on
 * purpose, for a statement that permanently deletes rows. Mirrors the
 * null-branch pin below and
 * docs/solutions/conventions/seed-cleanup-scripts-scope-by-authorid-2026-05-13.md
 * measure 5: a structural regex (`/\(.*author_id.*\)\s+and\s+\(/`) is
 * satisfied by a PARTIAL escape — a junk criterion hoisted OUT of the
 * author-scoped and() — and that mutant's param list is byte-identical too,
 * so a param-only pin can't catch it either. The REGRESSION GUARD test below
 * proves both. Trade-off, accepted knowingly: an exact pin also goes red on
 * a semantically-equivalent conjunct reorder — re-render and update the
 * literal deliberately (and, separately, if `LEGACY_TEST_PRODUCT_NAMES`
 * ever gains or loses an entry — the `($4, $5, $6)` param placeholders are
 * hardcoded to its current length).
 */
const EXPECTED_SQL_WITH_DEMO =
  '(("community_recipes"."author_id" is null or "community_recipes"."author_id" = $1) and ' +
  '("community_recipes"."normalized_product_name" ilike $2 or ' +
  '"community_recipes"."normalized_product_name" ilike $3 or ' +
  '"community_recipes"."normalized_product_name" in ($4, $5, $6)))';

/**
 * The three junk criteria, faithful to the source (`buildJunkRecipeWhere`'s
 * `or()` group) — the single source BOTH mutant fixtures below build from,
 * so a future criterion can't be added to one fixture and forgotten in the
 * other. Mirrors the sibling's `junkCriteria()`
 * (scripts/__tests__/cleanup-junk-recipes-utils.test.ts:65-73).
 */
const junkCriteria = () =>
  [
    ilike(communityRecipes.normalizedProductName, `${SEED_PREFIX}%`),
    ilike(communityRecipes.normalizedProductName, `${TEST_PREFIX}%`),
    inArray(communityRecipes.normalizedProductName, LEGACY_TEST_PRODUCT_NAMES),
  ] as const;

/**
 * `or(and(authorCondition, or(seedIlike, testIlike)), legacyInArray)` — the
 * legacy-name `inArray` criterion hoisted OUTSIDE the author scope. Mirrors
 * the sibling's committed helper
 * (scripts/__tests__/cleanup-junk-recipes-utils.test.ts:80-85).
 */
function partialEscape(authorCondition: SQL | undefined) {
  const [seedIlike, testIlike, legacyInArray] = junkCriteria();
  return render(
    or(and(authorCondition, or(seedIlike, testIlike)), legacyInArray),
  );
}

describe("cleanup-seed-recipes-utils", () => {
  describe("buildJunkRecipeWhere — the deletion perimeter", () => {
    it("with a demo user: renders EXACTLY the orphan-OR-demo scope ANDed with the name match", () => {
      const q = render(buildJunkRecipeWhere(DEMO_ID));
      expect(q.sql).toBe(EXPECTED_SQL_WITH_DEMO);
      expect(q.params).toEqual([
        DEMO_ID,
        SEED_PREFIX + "%",
        TEST_PREFIX + "%",
        ...LEGACY_TEST_PRODUCT_NAMES,
      ]);
    });

    it("REGRESSION GUARD: neither a flattened NOR a partial author-scope escape satisfies the exact pin", () => {
      // Two-sided negative control (docs/rules/harness.md: "a gate test needs
      // a two-sided negative control"), mirroring
      // scripts/__tests__/cleanup-junk-recipes-utils.test.ts:105-148.
      const demoAuthorCondition = or(
        isNull(communityRecipes.authorId),
        eq(communityRecipes.authorId, DEMO_ID),
      );

      // (a) Fully flattened: or(authorCond, ...criteria) — deletion re-opened
      // to every user. The loose regex this pin replaced DID catch this one.
      const flattened = render(or(demoAuthorCondition, ...junkCriteria()));
      expect(flattened.sql).not.toBe(EXPECTED_SQL_WITH_DEMO);
      expect(flattened.sql.toLowerCase()).not.toMatch(
        /\(.*author_id.*\)\s+and\s+\(/,
      );

      // (b) PARTIAL escape: the mutant hoists inArray(LEGACY_TEST_PRODUCT_NAMES)
      // OUT of the author-scoped and() — it would delete any user's matching
      // recipe regardless of authorId (the 2026-04-17 audit H1 incident this
      // scoping exists to prevent). This is why the pin is an exact string:
      // the fixture still SATISFIES the old loose regex (asserted below) and
      // its param list is byte-identical, so every structural/param assertion
      // the old test had would have passed it unchanged.
      const partial = partialEscape(demoAuthorCondition);
      expect(partial.sql).not.toBe(EXPECTED_SQL_WITH_DEMO);
      expect(partial.sql.toLowerCase()).toMatch(/\(.*author_id.*\)\s+and\s+\(/);
      expect(partial.params).toEqual([
        DEMO_ID,
        SEED_PREFIX + "%",
        TEST_PREFIX + "%",
        ...LEGACY_TEST_PRODUCT_NAMES,
      ]);
    });

    it("without a demo user: bare orphan scope, demo id absent from params", () => {
      const q = render(buildJunkRecipeWhere(null));
      expect(q.params).not.toContain("demo-user-42");
      // Exact-string match rather than a substring/regex check: the predicate
      // is small and fully deterministic, and an exact match is tamper-evident
      // against ANY regrouping — including one a regex can miss. A regex like
      // `/author_id"\s+is\s+null\s+and\s+\(/` still matches if the legacy-name
      // `inArray(...)` disjunct is pulled OUT of the inner OR and top-level
      // OR'd with the author-scoped AND (exactly the 2026-04-17 audit H1
      // incident this scoping exists to prevent — see
      // docs/solutions/conventions/seed-cleanup-scripts-scope-by-authorid-2026-05-13.md)
      // — that mutation still contains the "author_id" is null AND ( substring
      // even though a real user's "Original Pasta" recipe would again be
      // deletable regardless of authorId. Only the full string is safe.
      expect(q.sql).toBe(
        '("community_recipes"."author_id" is null and ' +
          '("community_recipes"."normalized_product_name" ilike $1 or ' +
          '"community_recipes"."normalized_product_name" ilike $2 or ' +
          '"community_recipes"."normalized_product_name" in ($3, $4, $5)))',
      );
      expect(q.params).toEqual([
        SEED_PREFIX + "%",
        TEST_PREFIX + "%",
        ...LEGACY_TEST_PRODUCT_NAMES,
      ]);
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

  describe("parseCleanupFlags — dry-run by default", () => {
    it("defaults to commit: false (a bare run must never delete)", () => {
      expect(parseCleanupFlags([])).toEqual({ commit: false, vetoed: false });
      expect(parseCleanupFlags(["--verbose"])).toEqual({
        commit: false,
        vetoed: false,
      });
    });

    it("arms deletion only on an explicit --commit", () => {
      expect(parseCleanupFlags(["--commit"])).toEqual({
        commit: true,
        vetoed: false,
      });
    });

    it("accepts legacy --dry-run as a harmless no-op alias (nothing vetoed)", () => {
      expect(parseCleanupFlags(["--dry-run"])).toEqual({
        commit: false,
        vetoed: false,
      });
    });

    it("--dry-run WINS over --commit in either order — and REPORTS the veto", () => {
      expect(parseCleanupFlags(["--commit", "--dry-run"])).toEqual({
        commit: false,
        vetoed: true,
      });
      expect(parseCleanupFlags(["--dry-run", "--commit"])).toEqual({
        commit: false,
        vetoed: true,
      });
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

  describe("cleanup-seed-recipes main() — the real commit gate (mocked db)", () => {
    // The banner text (asserted elsewhere via spawnSync against an
    // unreachable DB) sits BEFORE an unconditional `communityRecipes`
    // select; the actual `if (!commit) { ...; return; }` gate that decides
    // whether `db.transaction(...)` runs sits AFTER it. No no-DB spawnSync
    // test can ever reach that gate — this suite mocks `db`/`pool` so
    // `main()` runs the real script logic in-process, with one fixture row,
    // and asserts on the ONE thing that gate actually controls: whether
    // `db.transaction` is invoked at all.
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("a bare invocation does NOT reach db.transaction (must never delete)", async () => {
      await main([]);
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it("--commit DOES reach db.transaction (arms the delete)", async () => {
      await main(["--commit"]);
      expect(mockDb.transaction).toHaveBeenCalled();
    });

    it("--commit --dry-run does NOT reach db.transaction (--dry-run vetoes)", async () => {
      await main(["--commit", "--dry-run"]);
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    // NOTE on the `junkRecipes.length === 0` early return (line ~119, ahead
    // of the commit check): unlike the sibling cleanup-junk-recipes.ts,
    // db.transaction here is called INSIDE `for (let i = 0; i <
    // junkIds.length; ...)`, so it is already unreachable whenever the
    // result set is empty — proven below by mutation (deleting the early
    // return does NOT flip a `db.transaction` assertion). What the early
    // return actually short-circuits is the four cascade-count `db.select`
    // calls below it; asserting on `db.transaction` here would be a
    // decorative/non-discriminating test (see
    // docs/solutions/code-quality/lookalike-test-of-a-reimplemented-predicate-guards-nothing-2026-08-16.md),
    // so this pins the real observable instead.
    it("--commit with ZERO junk recipes found skips the cascade-count queries (exactly 2 selects — the guard ran, not just fewer queries)", async () => {
      mockDb.select
        .mockImplementationOnce(() => emptySelectChain()) // users lookup
        .mockImplementationOnce(() => emptySelectChain()); // junk query -> empty

      await main(["--commit"]);
      expect(mockDb.transaction).not.toHaveBeenCalled();
      expect(mockDb.select).toHaveBeenCalledTimes(2);
    });
  });

  describe("cleanup-seed-recipes banner — wiring seam (spawnSync, no DB)", () => {
    // What this DOES prove: the real script (not the -utils leaf) correctly
    // wires argv -> parseCleanupFlags -> the printed Mode banner. What it
    // does NOT prove: that the `if (!commit)` write gate itself is correct —
    // that gate sits behind an unconditional DB read this process never
    // reaches (see the mocked-db suite above, which owns that guarantee).
    //
    // DATABASE_URL is set to a syntactically-valid but UNREACHABLE address
    // (never deleted, unlike the db-free import-pin below) — `server/db.ts`
    // throws synchronously at import if DATABASE_URL is unset, which would
    // crash before the banner ever prints. `pg`'s Pool connects lazily, so
    // the banner (printed before any query) is unaffected by the connection
    // failing a moment later.
    const ROOT = join(__dirname, "..", "..", "..");
    const scriptPath = join(
      ROOT,
      "server",
      "scripts",
      "cleanup-seed-recipes.ts",
    );
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

    it("bare invocation prints Mode: DRY-RUN", () => {
      const r = run();
      expect(r.stdout).toContain("Mode: DRY-RUN  (pass --commit to delete)");
    });

    it("--commit prints Mode: COMMIT", () => {
      const r = run("--commit");
      expect(r.stdout).toContain("Mode: COMMIT");
    });

    it("--commit --dry-run prints Mode: DRY-RUN and NAMES --dry-run as the veto", () => {
      const r = run("--commit", "--dry-run");
      expect(r.stdout).toContain(
        "Mode: DRY-RUN  (--dry-run overrides --commit; drop --dry-run to delete)",
      );
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
      // Status carries the invariant; stderr uses a targeted negative, never
      // exact-empty — see server/services/__tests__/barcode-policy.test.ts
      // for why.
      expect(r.status).toBe(0);
      expect(r.stderr).not.toMatch(/error|DATABASE_URL/i);
    });
  });
});
