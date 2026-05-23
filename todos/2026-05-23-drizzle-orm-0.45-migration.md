---
title: "Migrate drizzle-orm to 0.45.2 (clears SQL-injection advisory) + fix DrizzleQueryError handlers"
status: backlog
priority: medium
created: 2026-05-23
updated: 2026-05-23
assignee:
labels: [deferred, database, security]
github_issue:
---

# Migrate drizzle-orm to 0.45.2 + fix DrizzleQueryError unique-violation handlers

## Summary

Bump `drizzle-orm` 0.39.3 → 0.45.2 to clear GHSA-gpj5-g38j-94v9 (HIGH: SQL injection
via improperly escaped SQL identifiers), and update the 6 production error-handlers that
detect Postgres unique-constraint violations, because drizzle 0.44+ now wraps driver
errors in a `DrizzleQueryError`.

## Background

Deferred from the 2026-05-23 dependency audit (Moderate scope = "no breaking changes").
The bump was attempted and reverted because it is a breaking change:

- The advisory is **not exploitable in this codebase** — a grep of all 191 `sql\`...\``usages found no`sql.identifier()`/`sql.raw()` fed by user input; every interpolation
  is a static column reference or a parameterized value. So urgency is low, but the fix is
  still worth landing in a focused PR.
- `drizzle-orm` 0.45.2 itself is **type-clean** with the current `drizzle-zod@0.7.1` and
  `zod@3.25.76` (verified via `tsc --noEmit`). Do NOT also bump `drizzle-zod` to 0.8.x —
  0.8 emits zod-4-shaped types (`ZodInt`, `{ out, in }`, `$ZodTypeInternals`) that do not
  structurally unify with the codebase's zod-3 schemas. drizzle-zod 0.8 is coupled to a
  separate zod 3→4 migration.

## The breaking change

drizzle 0.44+ wraps every failed query in a `DrizzleQueryError`:

- `.message` becomes `"Failed query: insert into ... params: ..."` (no longer the raw
  Postgres text like "duplicate key value violates unique constraint").
- The original pg driver error (with `.code === "23505"` and the "unique"/"duplicate key"
  text) is moved to `error.cause`.

`tsc` cannot catch this because catch-block errors are `unknown`/`any`. Only runtime tests
surface it — and only 1 of the 6 affected sites has a test
(`server/storage/__tests__/api-keys.test.ts` → "rejects a duplicate keyPrefix via the
unique constraint").

## Acceptance Criteria

- [ ] `drizzle-orm` bumped to `^0.45.2` (keep `drizzle-zod@^0.7.1`; do not touch zod)
- [ ] `npm audit` no longer reports the drizzle-orm HIGH advisory
- [ ] `tsc --noEmit` clean
- [ ] All 6 unique-violation handlers detect 23505 robustly (unwrap `error.cause`)
- [ ] `api-keys.test.ts` "rejects a duplicate keyPrefix" assertion updated to match the
      new error shape (assert on the wrapped cause / code, not the top-level message)
- [ ] Add/extend tests for the auth and nutrition race handlers if practical
- [ ] Full suite green (note: server integration tests are flaky under parallel runs —
      confirm failures are not in the touched files by re-running them in isolation)

## Implementation Notes

Recommended robust check (works pre- and post-wrap): inspect both `err` and `err.cause`
for `.code === "23505"`. Suggested shared helper, e.g. in `server/lib/`:

```ts
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}
```

The 6 sites that rely on the old error shape:

Code-based (`err.code === "23505"` — code now lives on `err.cause`):

- `server/storage/nutrition.ts:218` (favourite-toggle race)
- `server/storage/favourite-recipes.ts:102`
- `server/routes/recipe-catalog.ts:231`

Message-based (`err.message.includes("23505" | "unique")` — message now "Failed query…"):

- `server/routes/auth.ts:95` (registration race) — SECURITY-SENSITIVE; review carefully
- `server/routes/meal-plan.ts:578` (concurrent-confirm race)
- `server/routes/fasting.ts:99`

Use the `LSP` tool (not grep) to confirm no other catch-blocks inspect drizzle error
`.message`/`.code` before finishing. Review `drizzle-orm` 0.40→0.45 changelog for any
other behavior changes (e.g. `.returning()` / relational-query shape).

## Dependencies

- Independent of the zod 3→4 migration (keep drizzle-zod at 0.7.1).

## Risks

- `auth.ts` is JWT/auth-adjacent — per CLAUDE.md never delegate; a human must review.
- None of the 6 sites corrupt data today (the DB constraints still enforce integrity);
  they degrade rare race paths from clean 409/toggle-off to 500/propagated error. So this
  is correctness, not a live security hole.

## Updates

### 2026-05-23

- Created from the dependency-audit session. drizzle-orm 0.45 was installed, found to break
  6 unique-violation handlers, and reverted to 0.39.3 to keep the audit non-breaking.
