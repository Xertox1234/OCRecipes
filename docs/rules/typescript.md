# TypeScript Rules

- Never use `as` cast on a bare `text` DB column to derive a discriminated type — use a type guard (`function isFoo(x: string): x is Foo`) or Zod enum `.parse()`
- Never cast navigation types with `as never` or `as unknown` — define `CompositeNavigationProp` in `client/types/navigation.ts` for 3-level stack → tab → root composites
- JSONB columns typed with `$type<MyType>()` hint in the schema — don't add redundant `as MyType` casts on top of them
- Use a named update-fields type (e.g., `UpdateUserFields`) instead of `Partial<User>` in storage update functions — the narrower type surfaces compile-time errors when schema changes, and prevents mass-assignment
- `Drizzle .default([])` does NOT fix the TypeScript type — the inferred type stays `T[] | null` (not `T[]`); add `.notNull()` to make the TS type non-nullable and prevent null-access crashes on legacy rows
- PostgreSQL decimal aggregates (SUM, AVG) return strings via Drizzle — always `parseFloat()` or `Number()` the result
- A client-side Zod response schema must match the JSON **wire** shape, not the server Drizzle row type: `timestamp` columns serialize to ISO `z.string()` (not `z.date()`), `decimal`/`numeric` columns serialize to `z.string()` (not `z.number()`). Verify each field against the route handler's `res.json(...)` payload before writing the schema, and derive the exported result type from the schema (`z.infer<...>`) so the public type can't drift back to the row type
