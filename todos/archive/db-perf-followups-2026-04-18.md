---
title: "DB perf + column projection follow-ups from 2026-04-18 audit"
status: in-progress
priority: medium
created: 2026-04-18
updated: 2026-04-18
labels: [database, performance, audit-2026-04-18]
---

# DB perf + column projection follow-ups

## Summary

DB hygiene findings — column-projection cleanups, advisory-lock collision risk, session-store race, and seed/delete index consistency.

## Findings (cross-ref `docs/audits/2026-04-18-full.md`)

- **M18** — `SessionStore.createWithKey` calls `clearSession(key)` before the cap check. If the global cap rejects, the previous warm-up is already wiped. Reorder: check cap first, only clear after success.
- **M19** — `getCoachCachedResponse` does `db.select()` instead of `.select({ id, response })` — ships full `question` TEXT (up to ~2k chars) + timestamps on every cache hit. Narrow projection.
- **M20** — `getAllRecipeIngredients` does full `.select()` — only `name` used by search index. Narrow to `{ recipeId, name }`.
- **M21** — Seed script inserts directly via `db.insert(communityRecipes)` instead of `storage.createCommunityRecipe` — skips `addToIndex`. New seeds invisible until restart.
- **L28** — `getRecipesWithEmptyMealTypes` / `getCommunityRecipesWithEmptyMealTypes` don't check `discardedAt` — silent regression risk if the column is ever added.
- **L31** — Advisory lock `pg_advisory_xact_lock(hashtext(userId))` uses 32-bit int; collisions at ~65k users (>50% birthday probability). Trivial noise today; use `hashtextextended` two-int form at scale.

## Acceptance Criteria

- [ ] `createWithKey` cap check before clear
- [ ] `getCoachCachedResponse` column-projected
- [ ] `getAllRecipeIngredients` column-projected
- [ ] Seed script routed through `storage.createCommunityRecipe`
- [ ] `discardedAt` filter added to backfill query (defense-in-depth)
- [ ] 64-bit advisory lock key (at scale)

## Updates

### 2026-04-18

- Created from 2026-04-18 audit deferrals.
