---
title: Split an oversized storage module behind a thin re-export barrel
track: knowledge
category: design-patterns
module: server
tags: [architecture, storage, refactor, typescript, kimi-review]
applies_to: [server/storage/**/*.ts]
created: '2026-05-21'
---

# Split an oversized storage module behind a thin re-export barrel

## When this applies

A `server/storage/*.ts` module crosses the 500-line cap (architecture.md rule 1)
and must be split by sub-domain — without churning any consumer. Consumers
import the module three ways: `import * as x from "./mod"` (facade `index.ts`),
`export * from "./mod"` (intermediate facades like `meal-plans.ts`), and
`await import("../mod")` (storage integration tests destructure every public
function). All three must keep working with zero edits.

## Why

The original module name is the public surface. If you turn it into a thin
barrel that `export *`s from new sub-domain files, every existing import path
resolves unchanged — no call-site edits, an empty `git diff main` on the
facade, and identical LSP `findReferences` for every relocated symbol. Splitting
the file the naive way (renaming it, updating imports) instead churns dozens of
call sites and the test files.

## Examples

Precedent: `server/storage/meal-plans.ts` is already this shape.

```ts
// server/storage/community.ts  (was 563 lines → now a 15-line barrel)
export * from "./community-recipes"; // CRUD, FEATURED_COLUMNS, FeaturedRecipe, sharing
export * from "./community-generation-log"; // daily quota log + atomic limit check
export * from "./community-meal-types"; // meal-type backfill
```

Rules that make this safe:

1. **Bare `export *` re-exports both values and types.** `FEATURED_COLUMNS`
   (value) and `FeaturedRecipe` (type) both flow through one `export *` line. No
   need for separate `export type` unless TS complains about a specific symbol.
2. **Sub-modules import siblings directly, never the barrel.** When
   `meal-plan-recipes-browse.ts` needs `FEATURED_COLUMNS`, import from
   `"./community-recipes"`, NOT `"./community"`. A sub-module → barrel import is
   a latent circular-import hazard (the kimi gate flags it as a WARNING).
3. **Keep private symbols private.** `UNIFIED_PERSONAL_COLUMNS` is a bare
   `const` (not `export const`). Co-locate it with its only consumer
   (`getUnifiedRecipes`) and do NOT export it — exporting it changes the surface.
4. **Move each symbol's imports with it.** Each sub-module needs its own
   Drizzle ops, `db`, `./helpers`, search-index, schema, and shared-constant
   imports. Drop imports the sub-module no longer uses (e.g. `getDocumentStore`
   only belongs in the file that still calls it).

## Exceptions

A storage split is **pure mechanical extraction** — no behavior change. But the
kimi pre-commit gate is **diff-scoped**: code moved into a new file appears as
100% added lines, so the gate re-reviews long-standing logic as if newly
written and can emit CRITICALs (e.g. "no visibility filter on
`getCommunityRecipe`"). Before acting on any such finding, confirm the flagged
code is byte-identical to `main`:

```bash
git show main:server/storage/community.ts | sed -n '233,241p'
```

If it matches, the finding is out of scope for the refactor — do NOT "fix" it
inline (that changes behavior + churns the surface; security-sensitive storage
changes belong in a separate, deliberately-reviewed PR). Surface it for triage
and bypass the gate with `SKIP_KIMI_REVIEW=1 git commit ...`.

Verification order (cheap → expensive): `wc -l` each new file (< 500) →
targeted storage tests for the split modules → `check:types` → `lint` →
`git diff main -- server/storage/index.ts` (must be empty) → LSP
`findReferences` on 2-3 relocated public symbols (must match pre-split sites).

## Related Files

- `server/storage/index.ts` — top-level facade (must stay unchanged)
- `server/storage/meal-plans.ts` — precedent barrel + intermediate facade
- `server/storage/community.ts`, `server/storage/meal-plan-recipes.ts` — barrels
- `docs/rules/architecture.md` — the 500-line split rule + barrel-import rule

## See Also

- `docs/solutions/design-patterns/facade-mock-alignment-re-exported-values-2026-05-13.md`
- `docs/kimi-review-architecture.md` — why the gate is diff-scoped
