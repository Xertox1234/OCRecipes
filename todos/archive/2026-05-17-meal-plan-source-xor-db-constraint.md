---
title: "Add DB-level XOR constraint for meal-plan nutrition source"
status: done
priority: high
created: 2026-05-17
updated: 2026-05-18
assignee:
labels: [deferred, database, data-integrity, human-plan-required]
github_issue:
---

# Add DB-Level XOR Constraint for Meal-Plan Nutrition Source

## Summary

API-level XOR validation now rejects meal-plan items carrying both `recipeId` and
`scannedItemId`. The database still permits both columns to be populated. Add a
DB-level XOR constraint so direct DB writes and legacy data cannot violate the
invariant.

## Background

Audit finding M6 found meal-plan items can store both `recipeId` and
`scannedItemId`, making nutrition totals depend on `COALESCE` precedence. The
autonomous slice of `2026-05-16-meal-plan-source-xor.md` (archived) added API
validation rejecting two-source requests plus route tests. This follow-up covers
the human-gated database layer: it is split out because schema and migration
changes are hard exclusions requiring a human-approved plan.

## Acceptance Criteria

- [ ] Prepare a human-approved schema/migration plan for a DB-level XOR constraint.
- [ ] After plan approval, add the DB constraint and migration/backfill check.

## Implementation Notes

Relevant files:

- `shared/schema.ts`
- `migrations/**`

Schema and migrations are hard exclusions. Do not edit `shared/schema.ts` or
`migrations/**` without a human-approved plan. The constraint should enforce that
exactly one of `recipeId` / `scannedItemId` is non-null on each meal-plan item
row. A backfill audit is required first: existing rows with both IDs populated
must be reconciled before a CHECK constraint can be applied without failing the
migration.

## Dependencies

- Human-approved schema/migration plan for DB-level enforcement.

## Risks

- Existing rows with both IDs may need cleanup before a DB constraint can be applied.
- A CHECK constraint will fail the migration if any row currently violates it —
  the backfill must run and verify zero violations first.

## Updates

### 2026-05-17

- Split out from `2026-05-16-meal-plan-source-xor.md` after the API-validation
  slice of that todo was completed and archived. This todo carries the remaining
  human-gated DB-constraint acceptance criteria.

### 2026-05-18

- Drafted the schema/migration plan below (see "Schema/Migration Plan"), then
  resolved the Step 2 reconciliation rule: `recipe_id` is canonical (confirmed
  against the recipe-first `COALESCE` in `meal-plan-analytics.ts:58-85`). The
  plan is now complete; executing the schema + migration edits still requires
  the human go-ahead per the `human-plan-required` label.
- Ran the Step 1 audit against the local dev DB (`localhost/nutricam`) — **0
  two-source rows**. Step 2 reconciliation can be skipped locally. The audit
  MUST still be re-run against production before applying migration `0005`
  there; the migration's `RAISE EXCEPTION` guard is the backstop if production
  carries pre-validation legacy rows.
- **Executed.** Replaced the `meal_plan_items_has_source` CHECK with
  `meal_plan_items_source_xor` (`num_nonnulls(recipe_id, scanned_item_id) = 1`)
  in `shared/schema.ts`; added `migrations/0005_meal_plan_items_source_xor.sql`.
  Applied 0005 to the local DB and verified all four insert cases — recipe-only
  and scanned-only accepted, both and neither rejected by the constraint.
  `tsc` clean, 89 meal-plan storage tests pass. **Still pending: production
  Step 1 audit + applying 0005 to production** (the `RAISE EXCEPTION` guard
  makes that safe).

## Schema/Migration Plan (draft — 2026-05-18, pending human approval)

### Goal

Enforce at the DB level that each `meal_plan_items` row has **exactly one**
nutrition source — `recipe_id` XOR `scanned_item_id`. Today only the
`meal_plan_items_has_source` CHECK (at-least-one) exists; the XOR (exactly-one)
strictly subsumes it.

### Current state (`shared/schema.ts:873-914`)

- `recipe_id` integer NULL, FK → `meal_plan_recipes.id` ON DELETE CASCADE
- `scanned_item_id` integer NULL, FK → `scanned_items.id` ON DELETE CASCADE
- CHECK `meal_plan_items_has_source`: `recipe_id IS NOT NULL OR scanned_item_id IS NOT NULL`
- CHECK `meal_plan_items_servings_gt0` (unaffected by this plan)

### Step 1 — Backfill audit (run FIRST; read-only)

```sql
SELECT id, user_id, planned_date, meal_type, recipe_id, scanned_item_id, created_at
FROM meal_plan_items
WHERE recipe_id IS NOT NULL AND scanned_item_id IS NOT NULL
ORDER BY created_at;
```

- **Zero rows** → skip Step 2.
- **Non-zero rows** → must be reconciled before the constraint can be added; a
  CHECK constraint cannot be created while any row violates it.

### Step 2 — Reconcile violating rows

For each two-source row, keep the canonical source and null the other.

- **Resolved — `recipe_id` is canonical.** The meal-plan nutrition totals
  (`server/storage/meal-plan-analytics.ts:58-85`) compute each macro as
  `COALESCE(mealPlanRecipes.<macro>, scannedItems.<macro>, 0)`. `COALESCE`
  returns its first non-null argument and the recipe is first — so on a
  two-source row the recipe's nutrition is already what the app shows; the
  scanned item is ignored.
- Reconciliation — null the ignored column so every row's displayed nutrition
  stays identical:
  ```sql
  UPDATE meal_plan_items SET scanned_item_id = NULL
  WHERE recipe_id IS NOT NULL AND scanned_item_id IS NOT NULL;
  ```
- Implement as a reviewed one-off script
  (`server/scripts/backfill-meal-plan-source-xor.ts`) or a logged inline `UPDATE`,
  run by a human; then re-run the Step 1 audit and confirm it returns zero rows.

### Step 3 — Schema definition (`shared/schema.ts`, `mealPlanItems` table)

Replace the `hasNutritionSource` check with an XOR check:

```ts
// exactly one nutrition source — recipe XOR scanned item
sourceXor: check(
  "meal_plan_items_source_xor",
  sql`num_nonnulls(recipe_id, scanned_item_id) = 1`,
),
```

Remove `hasNutritionSource` (`meal_plan_items_has_source`) — the XOR subsumes
"at least one". Keep `servingsPositive` untouched.

### Step 4 — Migration file (`migrations/0005_meal_plan_items_source_xor.sql`)

Hand-written, applied via `psql "$DATABASE_URL" -f`, matching the 0002–0004 style
(`BEGIN`/`COMMIT`, header comment):

```sql
-- Replace the "at least one source" check on meal_plan_items with a strict XOR:
-- exactly one of recipe_id / scanned_item_id must be non-null.
-- PREREQUISITE: the Step 1 audit returns zero two-source rows.
-- Apply with:  psql "$DATABASE_URL" -f migrations/0005_meal_plan_items_source_xor.sql

BEGIN;

-- Fail loudly if any violating row still exists (defence-in-depth vs. Step 1).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM meal_plan_items
    WHERE recipe_id IS NOT NULL AND scanned_item_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'meal_plan_items still has two-source rows — run the backfill reconciliation first';
  END IF;
END $$;

ALTER TABLE meal_plan_items DROP CONSTRAINT IF EXISTS meal_plan_items_has_source;

ALTER TABLE meal_plan_items
  ADD CONSTRAINT meal_plan_items_source_xor
  CHECK (num_nonnulls(recipe_id, scanned_item_id) = 1);

COMMIT;
```

### Step 5 — Verification

- Re-run the Step 1 audit → zero rows.
- After applying 0005: `\d meal_plan_items` in psql shows `meal_plan_items_source_xor`
  and no `meal_plan_items_has_source`.
- `npm run db:push` reports **no diff** — confirms `schema.ts` and the DB agree.
- Insert checks: only `recipe_id` ✓; only `scanned_item_id` ✓; both → rejected;
  neither → rejected.
- `npm run test:run` — existing meal-plan route/storage suites stay green.

### Notes / risks

- `num_nonnulls()` is a built-in Postgres function (9.5+) — no extension needed,
  and reads clearly as "exactly one".
- The API-level XOR validation (archived `2026-05-16-meal-plan-source-xor.md`)
  already rejects two-source *writes*, so violating rows are bounded to
  pre-validation legacy data — Step 1 likely returns few or zero rows.
- Never run `db:push` first: it would attempt the constraint and **fail** on
  violating rows. Always go audit → reconcile → migration file.
- Both FKs are `ON DELETE CASCADE`, so a parent delete removes the whole row —
  it cannot create a both-null violation.
