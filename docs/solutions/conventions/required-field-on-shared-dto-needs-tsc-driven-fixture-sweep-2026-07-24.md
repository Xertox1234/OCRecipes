---
title: "Adding a required field to a shared DTO — verify completeness with tsc, not just grep"
track: knowledge
category: conventions
tags: [typescript, shared-types, testing, fixtures, dto, tsc]
module: shared
applies_to: [shared/schema.ts, shared/types/**/*.ts]
created: '2026-07-24'
---

# Adding a required field to a shared DTO — verify completeness with tsc, not just grep

## Rule

When adding a new **required** field to a type in `shared/` that has more than
one construction site (a resolved-recipe DTO built by two storage functions
and consumed by a route + a client hook + a component, for example), a manual
`grep -rln "<TypeName>"` sweep of the codebase is **necessary but not
sufficient** to find every place that needs updating. Test-only fixture
files — factories (`server/__tests__/factories/*.ts`), route-test mock
literals, and hook-mocked `mockResolvedValue([...])` arrays — are easy to
miss because:

1. They often live under a directory name (`__tests__/`, `factories/`) that
   doesn't obviously read as "constructs this DTO" from its path alone.
2. A pre-declared `const` object literal assigned to a *variable* (not passed
   inline as a function-call argument) does **not** get TypeScript's
   excess-property check treatment either way — a missing required property
   is still flagged, but only once the compiler actually type-checks the
   assignment context (e.g. `vi.mocked(fn).mockResolvedValue(myConstVar)`),
   which a text search can't simulate.

**After a manual sweep, always run `npm run check:types` (or `tsc --noEmit`)
as the authoritative completeness check before considering the field addition
done.** The compiler will surface every missed construction site as a
`Property '<field>' is missing in type '...' but required in type '<Type>'`
error, including ones a grep pass overlooked.

## Why

On a real sweep of `CarouselRecipeCard.allergens` (a new required field), a
careful upfront grep for `CarouselRecipeCard` across `client/`, `server/`,
and `shared/` found 8 files touching the type — but missed
`server/routes/__tests__/carousel.test.ts`, whose `mockCards` fixture array
matched the type only by structural inference through
`vi.mocked(buildCarousel).mockResolvedValue(mockCards)`, several call sites
away from its own declaration and with no literal mention of
`CarouselRecipeCard` in the file at all (the const array has no type
annotation). Only `npm run check:types` caught it — 8 near-identical
`TS2345` errors, all pointing at the same missing property.

## Examples

```bash
# Step 1: grep sweep — necessary, gives the starting candidate list
grep -rln "ResolvedFavouriteRecipe\|ResolvedCookbookRecipe\|CarouselRecipeCard" \
  client/ server/ shared/ --include="*.ts" --include="*.tsx"

# Step 2: make the field required in the shared type, update every
# construction site the sweep found.

# Step 3: MANDATORY — let the compiler find what the sweep missed.
npm run check:types
# Fix every "Property 'x' is missing... but required in type 'Y'" it reports,
# even in files the grep pass didn't surface. Repeat until clean.
```

## Exceptions

- If the field is added as **optional** (`field?: T`) instead of required,
  this whole class of missed-fixture bug is structurally impossible — but
  optional also means a future construction site can silently omit the field
  with no compiler signal at all. Prefer required when every construction
  site should be forced to make a conscious choice (this project's
  fail-dangerous safety-column convention — see
  [nullable-not-empty-for-derived-safety-columns-2026-05-17.md](nullable-not-empty-for-derived-safety-columns-2026-05-17.md) —
  is a case where required is the right call specifically *because* it forces
  every call site to decide `null` vs. a real value rather than defaulting to
  silence).
- A grep sweep is still worth doing first — it's much faster feedback than a
  full `tsc` run and catches the majority of sites immediately, letting you
  fix the "shape" of the change before running the slower authoritative
  check.

## Related Files

- `shared/types/carousel.ts` — the DTO whose `allergens` field addition
  surfaced this
- `server/routes/__tests__/carousel.test.ts` — the fixture the grep sweep
  missed
- `server/__tests__/factories/favourite-recipes.ts` — a second, similarly
  easy-to-miss fixture (a named factory function, not obviously
  "constructs `ResolvedFavouriteRecipe`" from a grep on the type name alone
  unless the type is in its import list)

## See Also

- [nullable-not-empty-for-derived-safety-columns-2026-05-17.md](nullable-not-empty-for-derived-safety-columns-2026-05-17.md) — the safety-column convention that motivates choosing required over optional in the first place
- [precautionary-safety-display-renders-nothing-never-safe-2026-07-24.md](precautionary-safety-display-renders-nothing-never-safe-2026-07-24.md) — the display-side half of the same fail-dangerous contract
