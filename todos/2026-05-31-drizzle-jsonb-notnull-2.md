---
title: "Drizzle jsonb .notNull() round 2 — 6 more columns + public-api casts"
status: backlog
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

- [ ] Add `.notNull()` to: `communityRecipes.canonicalImages` (schema:595), `.instructionDetails` (596-598), `.toolsRequired` (599-601), `.chefTips` (602), `medicationLogs.sideEffects` (1137), `menuScans.menuItems` (1170-1182)
- [ ] Remove the now-unnecessary `as` casts they forced: `public-api.ts:118-122` (`instructionDetails`/`toolsRequired`/`chefTips`/`canonicalImages`)
- [ ] Remove redundant `as string[]` + dead `?? []` on already-`.notNull()` columns `public-api.ts:105-106` (`dietTags`/`mealTypes`) (L5 — distinct: these are already non-null)
- [ ] Verify no migration is required for `.notNull()` on existing-default columns (or coordinate one); `npm run check:types` clean

## Implementation Notes

- Coordinate with the deferred drizzle-orm 0.45 migration todo (`2026-05-23-drizzle-orm-0.45-migration.md`) if schema work overlaps.
- `.notNull()` on a column that already has `.default([])` should not need a data backfill (no existing nulls), but confirm against the live schema before `db:push`.

## Risks

- Schema change — verify no NULLs exist in those columns before adding `.notNull()` (they shouldn't, given the `.default([])`, but confirm). Medium because it touches `shared/schema.ts`.

## Updates

### 2026-05-31

- Filed from the 2026-05-31 code-quality re-run, manifest M6 + L5.
