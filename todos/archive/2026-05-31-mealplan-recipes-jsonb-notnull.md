---
title: "Add .notNull() to mealPlanRecipes.dietTags + mealTypes jsonb-default columns"
status: done
priority: low
created: 2026-05-31
updated: 2026-05-31
assignee:
labels: [deferred, database, typescript]
github_issue:
---

# mealPlanRecipes jsonb-default columns missing .notNull()

## Summary

`mealPlanRecipes.dietTags` and `mealPlanRecipes.mealTypes` in `shared/schema.ts` use `jsonb().default([])` without `.notNull()`, so Drizzle infers `T[] | null` SELECT types — the same antipattern the 2026-05-31 drizzle-type-safety todo fixed for 7 other columns. Add `.notNull()` to these two.

## Background

Surfaced as an out-of-scope observation during the `drizzle-type-safety` todo (branch `todo/2026-05-31-drizzle-type-safety`). That todo's curated audit list named 7 columns (4 on `userProfiles`, 3 on `communityRecipes`); these two `mealPlanRecipes` columns share the identical pattern but were outside the named set, so they were deliberately left untouched. Roughly 6 other columns repo-wide may share the pattern — scope this todo to the two named here unless a quick audit shows the rest are trivially safe to include.

## Acceptance Criteria

- [ ] `mealPlanRecipes.dietTags` (~`shared/schema.ts:741`) has `.notNull()` added.
- [ ] `mealPlanRecipes.mealTypes` (~`shared/schema.ts:742`) has `.notNull()` added.
- [ ] `npm run check:types` still passes (inferred type changes from `T[] | null` to `T[]`; any previously-guarded null branches become dead, not errors).
- [ ] DB constraint verified: confirm the columns already have NOT NULL (implied by `.default([])`) via `npm run db:push` in dev or `\d meal_plan_recipes` in psql; add a migration only if the constraint was absent.
- [ ] All existing tests pass.

## Implementation Notes

- Mirror exactly what the `drizzle-type-safety` branch did for the other columns — `.notNull()` only changes the TypeScript type, not the DB (the column likely already has NOT NULL).
- Do NOT touch the intentionally-nullable `allergens` safety columns (see `docs/solutions/conventions/nullable-not-empty-for-derived-safety-columns`).
- drizzle-zod is held at 0.7.x — do not upgrade it.
- If the `drizzle-type-safety` branch has not merged yet, this can alternatively be folded into it (same 2-line pattern); otherwise keep it as a standalone follow-up.

## Dependencies

- Conceptually related to `todos/archive/2026-05-31-drizzle-type-safety.md`; not blocking.

## Risks

- Low — additive type-only change. Verify DB constraint before assuming no migration is needed.

## Updates

### 2026-05-31

- Created from the `drizzle-type-safety` out-of-scope observation during `/todo` deferred-warning triage.
- Implemented: added `.notNull()` to `mealPlanRecipes.dietTags` and `mealPlanRecipes.mealTypes` in `shared/schema.ts` (mirrors merged PR #297, which applied the identical change to `communityRecipes`). `check:types`, lint, and 5619 tests pass.
- DB constraint finding: the live dev DB columns `diet_tags`/`meal_types` are currently **nullable** (`is_nullable=YES`) with **0 NULL rows** — the `.default([])`-implies-NOT-NULL assumption was incorrect (confirmed by advisor + `information_schema` query). Applying the constraint is safe (no backfill needed) but was NOT applied: a targeted `ALTER TABLE meal_plan_recipes ALTER COLUMN diet_tags SET NOT NULL` (+ `meal_types`) was blocked by the migration classifier (needs explicit user approval), and `npm run db:push` aborts non-interactively on an unrelated `favourite_scanned_items` unique-constraint truncate prompt. AC #4 (DB constraint sync) remains pending user action; the type-only schema edit is shipped.
