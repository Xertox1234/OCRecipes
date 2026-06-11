<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "Drop orphaned carouselSuggestionCache table (no writers, no readers)"
status: done
priority: low
created: 2026-06-10
updated: 2026-06-10
assignee:
labels: [deferred, data-integrity, database]
github_issue:

---

# Drop orphaned carouselSuggestionCache table

## Summary

`carouselSuggestionCache` (`shared/schema.ts:1786-1813`) has no writers or
readers — carousel suggestions are built live via `server/storage/carousel.ts`
/ `server/services/carousel-builder.ts`. The table is kept alive only by the
TTL janitor in `server/storage/cache.ts:317`. Drop it via a schema migration,
or document why it's retained.

## Background

Surfaced by the 2026-06-10 full audit (finding L10, deferred at triage —
requires a `db:push` schema migration, same class as the archived
adaptive-goals columns drop). LSP findReferences (warmed) confirmed exactly two
non-schema references, both in `server/storage/cache.ts` (import + expired-row
cleanup). Not caught by the 2026-06-09 dead-export sweep because a pgTable
import isn't a dead _export_.

## Acceptance Criteria

- [ ] Re-verify zero writers/readers with LSP findReferences
- [ ] Remove the table from `shared/schema.ts` + the janitor entry in `server/storage/cache.ts` (+ test factory if any)
- [ ] `npm run db:push` against dev DB; verify prod migration plan
- [ ] If retaining instead: add a code comment at the schema definition saying why

## Implementation Notes

- Pattern precedent: `todos/P3-2026-06-09-drop-adaptive-goals-columns.md` (also a code-clean-but-schema-migration item).

## Dependencies

- None.

## Risks

- Confirm prod table is empty (it should be — nothing writes) before dropping.

## Updates

### 2026-06-10

- Initial creation — deferred from 2026-06-10 full audit (L10).
- Implemented. Reference sweep (LSP non-functional in executor worktree — exhaustive camelCase + snake_case + type-name grep across all file types, same fallback as the adaptive-goals precedent) found refs in: schema def + type export + `CarouselRecipeCard` import (`shared/schema.ts`), janitor entry (`server/storage/cache.ts`), test factory + index re-export + factory tests, `docs/DATABASE.md` section. All removed.
- Pre-drop row check (dev DB): 0 rows in `carousel_suggestion_cache` — confirms no writers.
- Migration `migrations/0008_drop_carousel_suggestion_cache.sql` (`DROP TABLE IF EXISTS`) applied to dev. PROD NOT YET APPLIED — apply at a deploy window AFTER the new bundle deploys (old bundle's janitor DELETEs this table every 6h; ordering note in the migration header, per `docs/solutions/conventions/deploy-before-drop-column-migration-2026-06-10.md`).
- `npm run db:push` verified no carousel diff remains; it surfaced unrelated pre-existing drift (drizzle-kit wants to re-add `favourite_scanned_items_user_id_scanned_item_id_unique`, which already exists in the dev DB) — not addressed here.
