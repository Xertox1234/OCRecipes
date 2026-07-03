---
title: 'Detect Postgres error codes via err.cause, not message text'
track: knowledge
category: conventions
module: server
tags: [database, drizzle, error-handling, postgres, gotchas]
applies_to: [server/storage/**/*.ts, server/routes/**/*.ts]
created: '2026-05-23'
---

# Detect Postgres error codes via err.cause, not message text

## Rule

When catching a database error to detect a constraint violation (unique `23505`, FK
`23503`, not-null `23502`, check `23514`), match on the **Postgres error code**, and check
**both `err.code` and `err.cause?.code`**. Never branch on `err.message.includes("unique" |
"duplicate key" | "23505")`. The driver error's `.code` is stable; its human-readable
message is not, and an ORM upgrade can move it.

```ts
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}
```

## Smell patterns

- `err.message.includes("unique")` / `msg.includes("23505")` in a `catch`
- `err.code === "23505"` with no `err.cause?.code` fallback
- `(error as { code: string }).code === "23505"` (cast hides the missing `.cause` path)

## Why

drizzle-orm **0.44+** wraps every failed query in a `DrizzleQueryError`: `.message`
becomes `"Failed query: insert into … params: …"` and the original pg driver error (the one
carrying `.code === "23505"` and the "duplicate key value violates unique constraint" text)
is moved to **`error.cause`**. Code that read `err.code` or scanned `err.message` silently
stops matching after the upgrade — and `tsc` can't catch it because catch-block errors are
`unknown`/`any`. Checking both `err.code` and `err.cause?.code` is correct on the current
drizzle 0.39 (unwrapped) **and** survives the deferred 0.45 migration. This codebase had 6
handlers using the fragile patterns above (auth registration race, favourite-toggle,
meal-plan confirm, recipe-catalog, favourite-recipes, fasting); see the migration todo.

## Exceptions

- Application-defined sentinel codes (e.g. `error.code === "NOT_FOUND"` thrown by your own
  service layer) are not pg errors and are unaffected — they aren't wrapped by drizzle.

## Related Files

- `server/storage/nutrition.ts`, `server/storage/favourite-recipes.ts`,
  `server/routes/recipe-catalog.ts` — `err.code === "23505"` (needs `.cause` fallback)
- `server/routes/auth.ts`, `server/routes/meal-plan.ts`, `server/routes/fasting.ts` —
  message-text matching (fragile)
- `todos/2026-05-23-drizzle-orm-0.45-migration.md` — the deferred fix + `isUniqueViolation` helper

## See Also

- [Drizzle sql template treats ${column} as bound parameters](drizzle-sql-template-bound-parameters-2026-05-13.md)
- [Defensive cache writes with onConflictDoNothing](defensive-cache-writes-onconflictdonothing-2026-05-13.md)
- [Auditing dependencies in the Expo + drizzle + zod stack](../best-practices/auditing-dependencies-expo-drizzle-zod-stack-2026-05-23.md)
