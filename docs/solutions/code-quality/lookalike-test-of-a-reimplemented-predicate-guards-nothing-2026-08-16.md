---
title: A lookalike test of a reimplemented predicate guards nothing — render the real query
track: bug
category: code-quality
tags: [testing, database, harness, drizzle, false-assurance, deletion-perimeter]
module: server
applies_to: ["server/scripts/**", "scripts/**"]
symptoms: ["A test file's header claims it 'pins the contract the SQL filter uses' but the tested function has zero importers outside the test", "Mutating the production predicate (e.g. anchoring an ILIKE pattern to unanchored) leaves the suite green", "A utils module exports both constants the script consumes AND a classifier function only the test consumes"]
created: 2026-08-16
severity: high
last_updated: 2026-08-16
---

# A lookalike test of a reimplemented predicate guards nothing — render the real query

## Problem

`cleanup-seed-recipes-utils.test.ts` tested `isJunkRecipeName` — a TypeScript
reimplementation of the cleanup script's SQL deletion filter. The script never
called it (grep-verified: zero importers outside the test); its real perimeter
was an inline Drizzle predicate in `main()`. The test's own header claimed it
"pins the contract that the same classification logic uses in the SQL filter" —
false. An unanchored `%seed-%` regression in the real predicate would have
deleted real user recipes while the suite stayed green, which is precisely the
failure the suite claimed to prevent.

## Symptoms

- The tested function shares CONSTANTS with the production code (so a rename
  fails the build) but not the LOGIC — prefix anchoring, author scoping, and
  AND/OR structure live twice and can drift independently.
- Mutation check fails: change the production `ilike` to `%seed-%` and every
  "does not match mid-string" assertion still passes.
- The test imports from a `-utils` module whose classifier export has no
  production caller.

## Root Cause

A predicate reimplemented in the test's language is a second implementation,
not an observation of the first. Green then proves only that the two copies
agree with the author's mental model at write time — the production copy can
change without touching the test's copy, and a silence-style guard ("real user
data must NOT match") passes hardest exactly when the copies have drifted.
This is the repo's "never write the logic under test inline in the test body"
rule (docs/rules/testing.md) with one level of indirection: the inline logic
moved to a utils file, which made it look like extraction when it was
duplication.

## Solution

Move the REAL predicate into the DB-free utils leaf, make the script execute
it, and assert on its rendered SQL — no database needed:

```ts
import { PgDialect } from "drizzle-orm/pg-core";
const q = new PgDialect().sqlToQuery(buildJunkRecipeWhere(demoUserId));
// Anchoring: no pattern param may begin with a wildcard.
for (const p of q.params.filter((p) => String(p).includes("%"))) {
  expect(String(p).startsWith("%")).toBe(false);
}
// Perimeter shape: author scope ANDed around the name-match OR.
expect(q.sql.toLowerCase()).toMatch(/\(.*author_id.*\)\s+and\s+\(/);
// Non-vacuity: exact param count — a silently emptied list turns red.
expect(q.params.length).toBe(2 + LEGACY_TEST_PRODUCT_NAMES.length);
```

Delete the lookalike and its suite — a wrong guard is worse than none, because
its green is cited as evidence. Assert table-QUALIFIED columns
(`"community_recipes"."title"`, not bare `"title"`) when sibling leaves are
structurally similar, so a wrong-table copy-paste cannot pass.

Even after implementing the "render the real query" fix, a structural-shape
assertion like the regex above can still be too weak. During the
`unify --dry-run/--commit polarity` work, a reviewer demonstrated that
pulling the `LEGACY_TEST_PRODUCT_NAMES` `inArray()` disjunct out of the inner
OR and top-level OR-ing it with the author-scoped AND — exactly the
regression this file's scoping exists to prevent — still produced SQL that
matched the `/\(.*author_id.*\)\s+and\s+\(/` regex **and** kept the same
param count. A real user's "Original Pasta" recipe would again be deletable
regardless of `authorId` while this regex-based guard stayed green.

**Prefer exact full-string SQL assertions over regex/substring checks** when
the rendered predicate is small enough to pin verbatim. For the same
`null-demoUserId` case in
`server/scripts/__tests__/cleanup-seed-recipes-utils.test.ts`, the verified
fix replaces the regex with:

```ts
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
```

An exact match is tamper-evident against **any** regrouping, not just the
specific one the regex author had in mind. When the predicate is too large
for a full-string match (e.g., many disjuncts from a dynamic list), at least
assert the **tree shape** of the condition (e.g., via a structured snapshot
of the AST or by counting parenthesized groups at each depth) rather than
relying on regex patterns that can be accidentally matched.

## Prevention

- Before trusting any test that claims to pin a query/filter/predicate
  "contract": grep the tested symbol's production importers. Zero importers =
  decoration; the claim in the header is the bug.
- Sharing constants is not sharing logic. If the test can only reach the logic
  by re-writing it, extract the real thing into a leaf the script executes
  (db-free leaf policy) and test that.
- `PgDialect().sqlToQuery()` renders any Drizzle condition deterministically —
  DB-free, so preflight's pg_isready skip never applies.
- When asserting the rendered SQL, prefer an **exact full-string match** on
  `q.sql` together with `expect(q.params).toEqual(...)` over regex/substring
  checks. A regex written to catch one known-bad regrouping can still pass a
  different regrouping that breaks the same invariant. Reserve regex assertions
  only for predicates that are genuinely too large to pin verbatim, and in that
  case assert the AST structure (e.g., via a snapshot of the condition tree)
  rather than a flat pattern.

## Related Files

- `server/scripts/cleanup-seed-recipes-utils.ts` — `buildJunkRecipeWhere`, the
  real perimeter (replaced `isJunkRecipeName`).
- `server/scripts/cleanup-seed-recipes.ts` — executes the leaf's predicate.
- `server/scripts/__tests__/cleanup-seed-recipes-utils.test.ts` — the rewritten
  suite (PR #824).

## See Also

- [A verification that scans ZERO inputs is green and meaningless](verification-that-scans-zero-inputs-is-green-and-meaningless-2026-08-07.md) — the same vacuous-green family, for verification runs.
- [A test comment must claim only what its own harness can observe](a-test-comment-must-claim-only-what-its-own-harness-can-observe-2026-08-06.md) — the header's false claim is this rule violated at file scope.
- [DB-free policy: leaf module for operator tooling](../design-patterns/db-free-policy-leaf-module-for-operator-tooling-2026-07-24.md) — the extraction pattern that makes the real predicate testable.