---
title: "Drizzle jsonb .notNull() round 2 — 6 more columns + public-api casts"
status: done
priority: medium
created: 2026-05-31
updated: 2026-05-31
assignee:
labels: [deferred, typescript, database]
github_issue:
---

# Drizzle jsonb .notNull() round 2

## Summary

Six more jsonb `.$type().default([])` columns lack `.notNull()`, so Drizzle infers `T[] | null` and forces unvalidated `as` casts in the public API serializer. Add `.notNull()` to align the type with the always-array post-default reality. Same class as the merged `drizzle-type-safety` todo (PRs #297/#307), new columns.

## Background

`docs/rules/typescript.md` line 7: a jsonb column with `.default([])` but no `.notNull()` is typed `T[] | null` on SELECT, so consumers must guard or cast. Today every consumer guards defensively (`?? []`, `Array.isArray`), so it's latent, not a live crash — but the `as` casts are a smell and a future null-access trap. Found in 2026-05-31 code-quality re-run (M6, L5).

## Acceptance Criteria

- [~] Add `.notNull()` to: `communityRecipes.canonicalImages` (schema:595), `.instructionDetails` (596-598), `.toolsRequired` (599-601), `.chefTips` (602) **— DONE**; `medicationLogs.sideEffects` (1137), `menuScans.menuItems` (1170-1182) **— NOT done in PR #324, deferred to `todos/P3-2026-06-02-drizzle-jsonb-notnull-remaining-2-columns.md`** (caught in the `/todo` merge review, 2026-06-02)
- [x] Remove the now-unnecessary `as` casts they forced: `public-api.ts:118-122` (`instructionDetails`/`toolsRequired`/`chefTips`/`canonicalImages`) — also dropped their trailing dead `?? []` for consistency with the L5 cleanup below
- [x] Remove redundant `as string[]` + dead `?? []` on already-`.notNull()` columns `public-api.ts:105-106` (`dietTags`/`mealTypes`) (L5 — distinct: these are already non-null)
- [x] Verify no migration is required for `.notNull()` on existing-default columns (or coordinate one); `npm run check:types` clean — **`check:types` clean; DB-constraint sync deferred** (see Updates 2026-06-02): live columns are `is_nullable=YES` with 0 NULL rows, so the `ALTER ... SET NOT NULL` is safe but classifier-blocked → pending user action, same as the prior round.

## Implementation Notes

- Coordinate with the deferred drizzle-orm 0.45 migration todo (`2026-05-23-drizzle-orm-0.45-migration.md`) if schema work overlaps.
- `.notNull()` on a column that already has `.default([])` should not need a data backfill (no existing nulls), but confirm against the live schema before `db:push`.

## Risks

- Schema change — verify no NULLs exist in those columns before adding `.notNull()` (they shouldn't, given the `.default([])`, but confirm). Medium because it touches `shared/schema.ts`.

## Updates

### 2026-05-31

- Filed from the 2026-05-31 code-quality re-run, manifest M6 + L5.

### 2026-06-02

- Implemented (PR #324, merged as `73fac45d`): added `.notNull()` to **4 of the 6** named jsonb columns in `shared/schema.ts` — the `communityRecipes` block (`canonicalImages`/`instructionDetails`/`toolsRequired`/`chefTips`). Removed the 4 `as` casts + their dead `?? []` at `server/routes/public-api.ts` (canonical content) and the 2 redundant `as string[]` + `?? []` on `dietTags`/`mealTypes`. `check:types`, lint (0 errors), and 5592 tests pass.
- **Correction (2026-06-02, `/todo` merge review):** the original wording of this Update claimed "all 6 named jsonb columns" — that was inaccurate. `medicationLogs.sideEffects` (1137) and `menuScans.menuItems` (1170-1182) were **NOT** modified by PR #324 (verified against the merged diff; neither column appears in it). They remain `.default([])` without `.notNull()`. Tracked for completion in `todos/P3-2026-06-02-drizzle-jsonb-notnull-remaining-2-columns.md`.
- **DB-constraint sync DEFERRED (same as the prior round / archived `2026-05-31-mealplan-recipes-jsonb-notnull.md`).** Queried the live dev DB: all 8 columns are `is_nullable=YES` with **0 NULL rows**. The schema now _asserts_ non-null (Drizzle SELECT type `T[]`) but the DB does not yet _enforce_ it. Applying `ALTER TABLE ... ALTER COLUMN ... SET NOT NULL` is safe (no backfill needed) but is blocked by the migration classifier (needs explicit user approval) and `db:push` aborts non-interactively. Removing the `?? []` runtime guards is provably safe today — `.default([])` + `.optional()` (not `.nullable()`) Zod insert schemas mean no app write path can seed a NULL — but it raises the stakes of the deferred `ALTER`. The deferred `ALTER ... SET NOT NULL` for these 6 columns (+ the prior rounds') is the only thing that closes the schema-vs-DB gap and is pending user action.
- kimi-review flagged 5 CRITICALs ("removed `?? []` will return null") — all **verified false-positive**: kimi sees only the diff (blind to the `.notNull()` in the same diff that makes the type non-null, which is why `check:types` passed), 0 NULL rows confirmed empirically, and write paths cannot seed a NULL.

### 2026-06-02 (DB `ALTER … SET NOT NULL` APPLIED — gap closed)

- **The deferred DB-constraint sync above is now RESOLVED.** Applied `ALTER TABLE … ALTER COLUMN … SET NOT NULL` to the **11** jsonb columns whose schema asserted `.notNull()` but whose DB column was still `is_nullable=YES` — broader than this round's 4, because earlier `.notNull()` rounds (`community_recipes.diet_tags`/`meal_types`/`ingredients` + all 4 `user_profiles` jsonb columns) had also never had their DB `ALTER` applied. Done as one atomic transaction on the local dev DB (`nutricam`) after verifying **0 NULL rows** in every column; re-queried `information_schema` to confirm all 11 now read `is_nullable=NO`; full suite (5609) green against the constrained DB.
- The two columns that remain nullable by design here — `medicationLogs.sideEffects`, `menuScans.menuItems` — are intentionally excluded (schema doesn't assert `.notNull()` for them yet); they are tracked in `todos/P3-2026-06-02-drizzle-jsonb-notnull-remaining-2-columns.md`, which will need its own small 2-column `ALTER` once that schema change lands.
