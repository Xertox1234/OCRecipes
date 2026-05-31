---
title: "Fix Drizzle type safety: add .notNull() to jsonb defaults + validate raw execute() results"
status: done
priority: low
created: 2026-05-31
updated: 2026-05-31
assignee:
labels: [deferred, database, typescript]
github_issue:
---

# Fix Drizzle type safety: add .notNull() to jsonb defaults + validate raw execute() results

## Summary

Two related Drizzle ORM type-safety gaps: (1) `jsonb().default([])` columns without `.notNull()` produce `T[] | null` SELECT types causing unsound `.length`/`.map()` access in services; (2) raw `db.execute(sql\`...\`)`result cast to domain type with`as T` provides no runtime validation.

## Background

Surfaced by `/audit code-quality` on 2026-05-31. Confirmed by Drizzle ORM documentation and live type-check.

**M4 — jsonb columns missing `.notNull()`** (`shared/schema.ts:80–89,533–546`):

Drizzle infers `T[] | null` for any column without `.notNull()`, even with `.default([])`. Affected columns:

- `userProfiles.allergies` (line 80)
- `userProfiles.healthConditions` (line 81)
- `userProfiles.foodDislikes` (line 83)
- `userProfiles.cuisinePreferences` (line 89)
- `mealPlanRecipes.dietTags` (line 533)
- `mealPlanRecipes.mealTypes` (line 534)
- `mealPlanRecipes.ingredients` (line 546)

Confirmed unsafe call site: `server/services/nutrition-coach.ts:249` — `context.dietaryProfile.allergies.length > 0` with no null guard. The type passes today because `dietaryProfile` is built from a typed service layer that may already coerce nulls, but the underlying schema type contract is wrong.

**L3 — `as WeightLog` cast on raw SQL** (`server/storage/health.ts:60`):

`db.execute(sql\`RETURNING \*\`)`returns`Record<string, unknown>[]`. Line 60 casts `result.rows[0] as WeightLog`— no runtime validation. Schema migration that adds/renames a column silently produces a misshapen object. (Line 85 uses`tx.execute<WeightLog>()` which constrains the TS type but is also unvalidated at runtime per Drizzle docs.)

## Acceptance Criteria

- [ ] All 7 `jsonb().default([])` columns in `shared/schema.ts` have `.notNull()` added: `allergies`, `healthConditions`, `foodDislikes`, `cuisinePreferences` (userProfiles), `dietTags`, `mealTypes`, `ingredients` (mealPlanRecipes)
- [ ] `npm run check:types` still passes after schema change (inferred type changes from `T[] | null` to `T[]` — any previously-guarded null-check branches become unnecessary but are not errors)
- [ ] `server/storage/health.ts:60` validates the raw SQL result — either via Zod parse of `result.rows[0]` against `WeightLog` schema, or at minimum via a helper that asserts required fields are present
- [ ] All existing tests still pass

## Implementation Notes

Adding `.notNull()` to Drizzle schema columns does NOT automatically run a DB migration. It only changes the TypeScript type. The DB columns likely already have NOT NULL constraints (implied by the `.default([])`) but this needs verification with `npm run db:push` in dev — or a migration if the constraint was absent.

Check `drizzle-zod` output for these tables after adding `.notNull()` to confirm the inferred select type changes as expected.

For health.ts, a lightweight Zod parse is preferable: import the `weightLogs` table's select schema and `.parse(result.rows[0])` to get a validated `WeightLog`. Do not use the cast-only pattern.

Note: `drizzle-zod` is held at 0.7.x (0.8 requires zod 4) — see `todos/2026-05-23-drizzle-orm-0.45-migration.md`.

## Dependencies

- `todos/2026-05-23-drizzle-orm-0.45-migration.md` (drizzle upgrade) — not a blocker for this todo, but coordinate on schema changes

## Risks

- Adding `.notNull()` to existing columns may require a DB migration if the constraint wasn't already present; verify with `\d tablename` in psql
- TypeScript inference change may ripple to code that was defensively checking `if (allergies !== null)` — those become dead branches (not errors, just unreachable)

## Updates

### 2026-05-31

- Created from `/audit code-quality` 2026-05-31 findings M4, L3
