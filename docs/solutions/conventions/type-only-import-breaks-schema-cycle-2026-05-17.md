---
title: "Type-only import to break a schema-shared-module circular dependency"
track: knowledge
category: conventions
tags:
  - typescript
  - drizzle
  - circular-import
  - schema
  - jsonb
module: shared
applies_to:
  - shared/schema.ts
  - shared/constants/allergens.ts
created: 2026-05-17
---

# Type-only import to break a schema-shared-module circular dependency

## Rule

When a Drizzle `jsonb` column in `shared/schema.ts` requires a precise
`$type<>()` annotation whose type lives in another shared module (e.g.
`shared/constants/allergens.ts`) that **itself** imports from `shared/schema.ts`
at runtime (for a schema definition like `allergySchema`), **do not** fall back
to a loose inline type. Instead, use a **type-only import** (`import type`) in
`schema.ts`.

Because `import type` is fully erased at compile time, it creates **no runtime
import cycle** even though the two modules reference each other:

- `schema.ts` → `allergens.ts` is type-only (erased — never in emitted JS)
- `allergens.ts` → `schema.ts` is a real runtime dependency

Additionally, pair `jsonb` array columns with `.notNull().default([])` so the
inferred TypeScript type is non-nullable (`T[]`, not `T[] | null`).

## When this applies

- A shared Drizzle schema module (`schema.ts`) defines a table with a `jsonb`
  column.
- The column's type should be an imported type from another shared module.
- That other module already imports from `schema.ts` at runtime.
- A naive `import` would create a runtime circular dependency, but you still
  want the column type precise (not an anonymous inline literal or `any`).

## Why

- **No runtime cycle**: `import type` is erased by TypeScript and never emitted
  to JavaScript, so it does not contribute to circular `require()` chains.
- **Exact type safety**: the column retains the exact interface from the
  external module (`DerivedRecipeAllergen[]`) instead of an anonymous
  `{ id: string; viaDerived: boolean }[]`.
- **Cleaner assignments**: code that builds the column value (e.g. a
  `SearchableRecipe` normalizer) can assign the imported type directly with no
  `as` cast — and `as` casts on a typed value are themselves a flagged smell.

## Examples

### `shared/schema.ts` — fixed with a type-only import

```typescript
import type { DerivedRecipeAllergen } from "./constants/allergens";

export const communityRecipes = pgTable("community_recipes", {
  // ...
  allergens: jsonb("allergens")
    .$type<DerivedRecipeAllergen[]>()
    .notNull()
    .default([]),
});
```

`allergens.ts` keeps its runtime import of `schema.ts`:

```typescript
// shared/constants/allergens.ts
import { allergySchema } from "@shared/schema"; // runtime import — fine
export interface DerivedRecipeAllergen {
  id: AllergenId;
  viaDerived: boolean;
}
```

A naive `import { DerivedRecipeAllergen }` (value import) in `schema.ts` would
create the cycle `schema.ts → allergens.ts → schema.ts`. The `import type` form
breaks it because the `schema.ts → allergens.ts` edge is erased.

## Related Files

- `shared/schema.ts`
- `shared/constants/allergens.ts`

## See Also

- [TypeScript type-only imports](https://www.typescriptlang.org/docs/handbook/modules/reference.html#type-only-imports-and-exports)
- `docs/rules/typescript.md` — Drizzle `.default([])` + `.notNull()` rule
