<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "R2 backfill script: bounded concurrency + idempotent re-runs (uploaded-key record)"
status: backlog
priority: low
created: 2026-06-10
updated: 2026-06-10
assignee:
labels: [deferred, database, performance]
github_issue:

---

# R2 backfill script hardening

## Summary

Two deferred findings from the 2026-06-10 full audit on
`server/scripts/migrate-images-to-r2.ts` (L6, L8): uploads run strictly
serially, and the upload→DB-update sequence is non-atomic — a failed UPDATE or
a re-run orphans the previously uploaded object (fresh random key per call).

## Background

One-shot ops script, so severity is Low — but if the migration ever needs a
re-run at scale these matter. The 2026-06-10 audit already added `--dry-run`
flag validation, unknown-flag rejection, and a non-zero exit code on partial
failure; this todo covers the remaining throughput/idempotency work.

Also from the 2026-06-10 security review: the deprecated disk-migration
scripts' `ALLOW_DEPRECATED_DISK_MIGRATION=1` override should print a loud
"override active" warning (and consider gating on `NODE_ENV !== "production"`)
so a value left in `.env` can't silently re-enable them.

## Acceptance Criteria

- [ ] Bounded-concurrency pool (e.g. 5, mirroring SEED_CONCURRENCY) for per-row uploads, preserving per-row try/catch failure isolation
- [ ] Re-run idempotency: record uploaded keys (or derive deterministic keys from row id/content hash) so a failed UPDATE doesn't orphan the first object on retry
- [ ] Deprecated scripts print a loud override-active warning when ALLOW_DEPRECATED_DISK_MIGRATION=1

## Implementation Notes

- Deterministic key option per AWS SDK guidance: derive from the DB row id (e.g. `recipe-row-<id>.<ext>`) instead of `crypto.randomUUID()` *within the migration script only* — the runtime `saveRecipeImage` random key is correct for live traffic.

## Dependencies

- None (migration already ran in prod; this is for potential re-runs/new environments).

## Risks

- Low — ops-script-only changes.

## Updates

### 2026-06-10

- Initial creation — deferred from 2026-06-10 full audit (L6, L8 + review suggestion).
