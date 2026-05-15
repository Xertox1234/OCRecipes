---
title: "Schema and data-integrity debt from 2026-04-26 audit"
status: complete
priority: high
created: 2026-04-26
updated: 2026-04-26
labels: [data-integrity, database, schema, audit-2026-04-26]
audit_ids: [H2, M8, M9, L9, L10, L11, L12]
---

# Schema and data-integrity debt from 2026-04-26 audit

## Summary

Six schema-level data-integrity issues identified in the 2026-04-26 audit. H2 re-surfaces the archived `nutrition-accuracy-2026-04-18.md` H10-followup — community recipe nutrition columns are still `text` type with no DB constraints, unlike `mealPlanRecipes` which uses `decimal(10,2)` + CHECK constraints.

## Findings (cross-ref `docs/audits/2026-04-26-full.md`)

- **H2** — `communityRecipes` nutrition columns (`caloriesPerServing`, `proteinPerServing`, `carbsPerServing`, `fatPerServing`) are `text` type with no non-negative CHECK constraints. `mealPlanRecipes` uses `decimal(10,2)` + explicit CHECKs. Aggregation in `getDailySummary` silently returns NULL on non-numeric strings. `shared/schema.ts:503–506`
- **M8** — `coachResponseCache` has no `userId` column. Hash embeds userId but there's no FK → no cascade on user delete. User cache entries survive account deletion. `shared/schema.ts:1402–1421`, `server/storage/users.ts:177`
- **M9** — `weight_logs` unique index (`weight_logs_user_date_idx`) keys on full `timestamp`, not date. Multiple entries per day are allowed. `onConflictDoUpdate` inserts a new row for different-time entries. Downstream trend math double-counts. `shared/schema.ts:814`, `server/storage/users.ts:426–443`
- **L9** — `appetiteLevel` CHECK constraint (`>= 1 AND <= 5`) doesn't protect out-of-range values when column is NULL — `NULL >= 1` evaluates to NULL, bypassing the check. `shared/schema.ts:1027, 1035–1038`
- **L10** — `mealSuggestionCache.suggestions` (line 1375) and `carouselSuggestionCache.suggestions` (line 1891) are bare `jsonb()` without `.$type<…>()` annotation. Reads infer as `unknown`; callers cast unsafely. `suggestionCache.suggestions` already has `.$type<SuggestionData[]>()` as the pattern. `shared/schema.ts:1375, 1891`
- **L11** — `communityRecipes.likeCount` is never incremented by any route, storage, or service. Always 0. Defeats any sorted-by-likes discovery. Either wire up the increment or drop the column. `shared/schema.ts:509`
- **L12** — `SessionStore.canCreate` and `create` are not atomic — concurrent requests can both pass the check before either increments. Low risk under single-threaded Node.js but real window with async gaps between check and create. `server/storage/sessions.ts:113–145`

## Acceptance Criteria

- [ ] `communityRecipes` nutrition columns changed to `decimal(10,2)` (or `numeric`) with non-negative CHECK constraints matching `mealPlanRecipes` pattern
- [ ] Migration verified: no existing rows violate constraints (pre-migration query)
- [ ] `coachResponseCache` gains a `userId` column with FK → `users.id` ON DELETE CASCADE; OR existing per-user cache entries are deleted from `deleteUser`
- [ ] `weight_logs` unique index updated to key on `(userId, DATE(loggedAt))` — one entry per user per day
- [ ] `appetiteLevel` CHECK updated to `IS NULL OR (appetiteLevel >= 1 AND appetiteLevel <= 5)`
- [ ] `mealSuggestionCache.suggestions` and `carouselSuggestionCache.suggestions` get `.$type<…>()` annotations
- [ ] `likeCount` either wired up (route + storage to increment) or removed from schema
- [ ] `SessionStore.create` performs the count check atomically (inline with increment, not as a separate method call)
- [ ] All existing tests pass; new tests for weight-log dedup and session TOCTOU guard

## Implementation Notes

- H2 (nutrition column type change) is the most involved: requires Drizzle migration, backfill for seed/imported recipes via `nutrition-lookup` service, and removal of the `numericPassThrough` carve-out added in the 2026-04-18 H10 fix. See archived `todos/archive/nutrition-accuracy-2026-04-18.md` for full scope.
- M9 (weight_logs date index): PostgreSQL doesn't support functional unique indexes via Drizzle DSL directly — may require a raw SQL migration with `uniqueIndex on (user_id, DATE(logged_at))`.
- L12 (SessionStore): simplest fix is a single `createIfAllowed(data)` method that checks-and-increments atomically using a Map-level lock or by restructuring the count logic inline.
