# TypeScript Rules

- Never use `as` cast on a bare `text` DB column to derive a discriminated type — use a type guard (`function isFoo(x: string): x is Foo`) or Zod enum `.parse()`
- Never cast navigation types with `as never` or `as unknown` — define `CompositeNavigationProp` in `client/types/navigation.ts` for 3-level stack → tab → root composites
- JSONB columns typed with `$type<MyType>()` hint in the schema — don't add redundant `as MyType` casts on top of them
- `Partial<User>` in storage update functions enables mass-assignment — always use an explicit field whitelist type instead
- `Drizzle .default([])` does NOT make the TypeScript type non-nullable — the inferred type stays `T[] | null`; add `.notNull()` alongside
- PostgreSQL decimal aggregates (SUM, AVG) return strings via Drizzle — always `parseFloat()` or `Number()` the result
