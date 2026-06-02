---
title: "Drizzle jsonb .notNull() — finish remaining 2 columns (sideEffects, menuItems)"
status: backlog
priority: low
created: 2026-06-02
updated: 2026-06-02
assignee:
labels: [deferred, typescript, database]
github_issue:
---

# Drizzle jsonb .notNull() — remaining 2 columns

## Summary

PR #324 (`73fac45d`) added `.notNull()` to 4 of the 6 jsonb `.default([])` columns named
in its AC — the `communityRecipes` canonical-content block. The other two were not
touched and still infer `T[] | null` on SELECT: `medicationLogs.sideEffects` and
`menuScans.menuItems`. Finish the cleanup by adding `.notNull()` to both.

## Background

Filed from the `/todo` merge review on 2026-06-02. PR #324's executor reported "all 6
columns" but the merged diff only modified 4 (verified: neither `side_effects` nor
`menu_items` appears in the #324 diff). The parent todo is archived at
`todos/archive/P2-2026-05-31-drizzle-jsonb-notnull-2.md` with a correction note. Same
latent-type-smell class as the parent — consumers guard defensively today (`?? []` /
`Array.isArray`), so it is not a live crash, just an `as`/null-access smell.

## Acceptance Criteria

- [ ] Add `.notNull()` to `medicationLogs.sideEffects` — `shared/schema.ts:1137`
      (`jsonb("side_effects").$type<string[]>().default([])`).
- [ ] Add `.notNull()` to `menuScans.menuItems` — `shared/schema.ts:1170-1182`
      (`jsonb("menu_items").$type<{…}[]>().default([])`).
- [ ] Check consumers of both columns for now-removable `as`/`?? []` guards (the parent
      todo only listed public-api casts for the `communityRecipes` columns; these two are
      not in `public-api.ts`). Use LSP find-references on the column accessors, not grep.
      Remove only guards that become provably dead; keep any that follow a different code path.
- [ ] `npm run check:types` clean; no consumer relies on the columns being null.

## Implementation Notes

- Mirror exactly what PR #324 did for the 4 `communityRecipes` columns: append `.notNull()`
  after `.default([])`.
- **DB-constraint sync for these 2 columns is the only ALTER still outstanding.** Adding
  `.notNull()` is a schema-level _type_ assertion only — these 2 DB columns are still
  `is_nullable=YES` (0 NULL rows). After the schema change, the DB needs
  `ALTER TABLE "medication_logs" ALTER COLUMN "side_effects" SET NOT NULL;` and
  `ALTER TABLE "menu_scans" ALTER COLUMN "menu_items" SET NOT NULL;` (verify 0 NULL rows
  first). Do NOT attempt the ALTER from an executor worktree.
- **Note (2026-06-02):** the parent rounds' ALTER is **already applied** — the 11 columns
  that previously asserted `.notNull()` in the schema without DB enforcement were synced on
  2026-06-02 (see archived `P2-2026-05-31-drizzle-jsonb-notnull-2.md` → final Update). So
  this todo's ALTER is a standalone 2-column change, not "coordinate with a pending parent
  batch" — that batch is done. Tooling: no `psql` is installed locally; run ad-hoc SQL via
  `NODE_PATH=node_modules node` with a `pg` Client against `DATABASE_URL` (dev DB `nutricam`).

## Dependencies

- Continuation of archived `todos/archive/P2-2026-05-31-drizzle-jsonb-notnull-2.md` (PR #324).

## Risks

- Low. Type-only schema change; same pattern as the 4 already merged. The only risk is a
  consumer that expects a possible-null value — `check:types` will catch it (the `.default([])`
  means a NULL is never actually returned, so none should).

## Updates

### 2026-06-02

- Filed from the `/todo` merge-review catch: PR #324 completed 4/6 columns; this covers the
  remaining 2.
