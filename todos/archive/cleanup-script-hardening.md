---
title: "Cleanup Seed Recipes Script — Hardening"
status: in-progress
priority: medium
created: 2026-04-17
updated: 2026-04-17
assignee:
labels: [security, scripts, audit-followup]
---

# Cleanup-Seed-Recipes Script Hardening

## Summary

H1 (authorId scope) landed in audit 2026-04-17, but several defensive gaps
remain in `server/scripts/cleanup-seed-recipes.ts`: path-traversal on image
filename, polymorphic FK with no `recipeType` filter, and unverified FK
cascade semantics.

## Background

The script is dev-facing but may be run against production when seed data
leaks through tests (hence the "test leaks" branch added alongside H1).
Every deletion path should be defense-in-depth.

## Acceptance Criteria

- [ ] **M4** Validate `filename` matches `/^[a-zA-Z0-9._-]+\.(jpg|jpeg|png|webp)$/`
      before `fs.unlinkSync(path.join(RECIPE_IMAGES_DIR, filename))` —
      reject path traversal via stored `imageUrl` containing `../`
- [ ] **M5** Add `eq(recipeDismissals.recipeType, "community")` alongside
      `inArray(recipeDismissals.recipeIdentifier, dismissalIdentifiers)` so
      the script cannot accidentally delete dismissals for `mealPlan:N` when
      cleaning `community:N` with a matching integer ID
- [ ] **L4** Verify `recipeGenerationLog.recipeId` FK cascade in schema:
      if `onDelete: set null`, the script leaves orphaned rows that skew the
      daily-limit counter; either migrate to cascade or explicitly delete
      `WHERE recipeId IN (...)` (script already does this — just verify it's
      complete vs. the FK behavior)
- [ ] **L5** Fix success counter: current code increments `successCount`
      for both newly-inserted AND already-existing rows, masking partial
      failures on re-runs. Split into `inserted` / `skipped` counters
- [ ] Add `--dry-run` flag that logs the `id` + `title` + `authorId` of every
      row that would be deleted (plus count of cascaded rows per junction
      table) without committing

## Implementation Notes

- The cleanup script is currently destructive by default. `--dry-run` should
  be the default, with `--commit` required to actually delete. If switching
  the default breaks `npm run cleanup:seeds` muscle memory, document the
  change in CLAUDE.md.
- M5 is the same polymorphic-FK hygiene pattern as the previous audit's
  cookbook orphan cleanup — reference `docs/patterns/database.md` polymorphic
  FK section when implementing.

## Related Audit Findings

M4, M5, L4, L5 (audit 2026-04-17)

## Updates

### 2026-04-17

- Created from audit #11 deferred Medium/Low items
