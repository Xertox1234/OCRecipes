---
title: "A write gate behind an unconditional DB read is unreachable by a no-DB spawnSync smoke test — mock the db collaborator in-process instead"
track: knowledge
category: conventions
tags: [testing, harness, database, vitest, drizzle, mocking]
module: server
applies_to: ["scripts/**/*.ts", "server/scripts/**/*.ts"]
created: 2026-08-16
---

# A write gate behind an unconditional DB read is unreachable by a no-DB spawnSync smoke test

## Rule

When a script's destructive write is gated by `if (COMMIT) { await db.update(...) }` (or an
equivalent early-return), and that gate sits AFTER at least one unconditional `await
db.select(...)` call, a `spawnSync`-based smoke test run against an unreachable database can
**never** exercise the gate — the process crashes on the read, before the gate's code is ever
reached, identically regardless of which flag was passed. Verify this before trusting such a
test: invert ONLY the destructive `if` (leave everything else, including any printed banner,
untouched) and confirm the "smoke test" stays green. If it does, the test proves argv-to-banner
wiring, not the write gate.

The only way to reach and discriminate such a gate without a real database is to:

1. Export the script's entry function (`export async function main(argv = process.argv)`),
   guarded by an `isMain` check (`process.argv[1]?.includes("<script-name>")`) so the real CLI's
   auto-invoke at module load is unaffected.
2. `vi.mock` the `db` collaborator with a single flat object that is BOTH chainable (every
   builder method returns the same object) AND thenable (a `.then()` property resolves a fixture
   row) — this stands in for a Drizzle query/transaction builder regardless of whether `.where()`
   or `.returning()` ends the chain.
3. Call `main(argv)` directly in the test, mocked db in place, and assert on the ONE thing the
   gate controls (e.g. `expect(db.transaction).toHaveBeenCalled()` / `.not.toHaveBeenCalled()`).
4. RED-verify: temporarily invert the real gate line, re-run, confirm the new test (and only it)
   fails, then restore.

## Smell patterns

- A test's own claim ("proves the write gate is tested") is contradicted by tracing the code:
  the assertion target (banner text on stdout) prints BEFORE the first `await db.*` call, while
  the destructive statement is AFTER it.
- `DATABASE_URL` deleted for a script-level smoke test — this crashes at import if the script's
  db module throws synchronously on an unset `DATABASE_URL` (as `server/db.ts` does), before the
  banner ever prints. Set it to a syntactically valid but unreachable address instead (e.g.
  `postgresql://t:t@127.0.0.1:1/nope`) — `pg`'s `Pool` connects lazily, so a banner printed before
  any query is unaffected by the later connection failure.
- A compound gate (`if (!COMMIT || result.length === 0)`) gets a test for only one axis (COMMIT),
  with every fixture returning a non-empty result — the `length === 0` axis is silently untested.

## Why

A no-DB spawnSync test and an in-process mocked-db test answer different questions. The former
proves the SCRIPT correctly wires `argv` into whatever it prints before touching the database —
a real, previously uncovered seam (the `*-utils.ts` leaf's flag-parsing function can be perfect
while the SCRIPT forgets to call it, or calls it with the wrong `argv` slice). It structurally
cannot prove anything about code that runs after the first DB call, because that code is never
reached. Only the latter reaches the destructive statement itself.

Do not assume symmetry between superficially similar sibling scripts. In this repo,
`cleanup-junk-recipes.ts` calls `db.transaction(...)` UNCONDITIONALLY right after its
`length === 0` early-return check, so breaking that check flips the `db.transaction`-called
assertion. `cleanup-seed-recipes.ts`'s `db.transaction(...)` call is nested inside
`for (let i = 0; i < junkIds.length; i += BATCH)` — so it is ALREADY unreachable on an empty
result regardless of the earlier `if` — asserting `db.transaction` there for the empty-result
case is a decorative, non-discriminating test (confirmed by mutation: disabling the early return
did not flip that assertion). The genuinely discriminating observable for THAT script was the
`db.select` call count (2 vs 7, since the early return is what skips four cascade-count queries
plus a final remaining-count query). Verify each gate's real observable by mutation — never
assume the same assertion transfers across two scripts that merely look alike.

## Examples

```ts
// vi.mock factory — everything defined INSIDE it (hoisted above module-scope consts)
vi.mock("../../server/db", () => {
  const FIXTURE_ROW = { id: 1, title: "Fixture", authorId: null };
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
      transaction: vi.fn((cb: (tx: unknown) => Promise<unknown>) =>
        Promise.resolve(cb(chain)),
      ),
    },
  };
});

// production script — the escape hatch this pattern requires
export async function main(argv: readonly string[] = process.argv) {
  const { commit: COMMIT } = parseCleanupFlags(argv);
  // ...
}
const isMain = (() => {
  try {
    return Boolean(process.argv[1]?.includes("cleanup-junk-recipes"));
  } catch {
    return false;
  }
})();
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

A script that calls `process.exit(...)` directly (not just via the outer `.catch`) needs the spy
to THROW, not no-op — a no-op mock lets execution fall through past an early-exit `if` block
(which has no `return` after `process.exit`, relying on the process actually dying) straight
into the destructive code, silently breaking the exact discrimination the test exists to prove.
Assert both `instanceof` (that it's genuinely the spy's signal, not some other rejection) and the
payload — a bare `toMatchObject({ code: 0 })` alone would also match an unrelated thrown object
that happens to carry a `code: 0` property:

```ts
class ProcessExitSignal extends Error {
  constructor(public code?: string | number | null) {
    super(`process.exit(${code})`);
  }
}
vi.spyOn(process, "exit").mockImplementation((code): never => {
  throw new ProcessExitSignal(code);
});
// ...
const err: unknown = await main([]).catch((e: unknown) => e);
expect(err).toBeInstanceOf(ProcessExitSignal);
expect(err).toMatchObject({ code: 0 });
```

## Exceptions

- If the script's destructive statement is reachable with zero DB round-trips (rare), a no-DB
  spawnSync test may suffice — always verify by mutation first rather than assuming.
- Keep the no-DB spawnSync banner test too, even after adding the mocked-db suite — they cover
  different seams (argv-to-banner wiring vs. the actual gate) and neither subsumes the other.

## Related Files

- `scripts/migrate-recipe-ingredients.ts`
- `scripts/cleanup-junk-recipes.ts`
- `server/scripts/cleanup-seed-recipes.ts`
- `scripts/__tests__/migrate-recipe-ingredients-utils.test.ts`
- `scripts/__tests__/cleanup-junk-recipes-utils.test.ts`
- `server/scripts/__tests__/cleanup-seed-recipes-utils.test.ts`

## See Also

- [../design-patterns/db-free-policy-leaf-module-for-operator-tooling-2026-07-24.md](../design-patterns/db-free-policy-leaf-module-for-operator-tooling-2026-07-24.md) — the sibling extraction pattern for db-free operator tooling
- [gate-test-needs-two-sided-negative-control-2026-07-25.md](gate-test-needs-two-sided-negative-control-2026-07-25.md) — the general two-sided-control discipline this pattern applies to a DB-gated write
- [../code-quality/lookalike-test-of-a-reimplemented-predicate-guards-nothing-2026-08-16.md](../code-quality/lookalike-test-of-a-reimplemented-predicate-guards-nothing-2026-08-16.md) — the same "verify what the harness can actually observe" discipline
- [../logic-errors/safety-flag-must-veto-not-alias-2026-08-16.md](../logic-errors/safety-flag-must-veto-not-alias-2026-08-16.md) — the banner-wording precedent this pattern's spawnSync suite pins
