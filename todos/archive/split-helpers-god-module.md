---
title: "Split _helpers.ts god module into focused files"
status: backlog
priority: medium
created: 2026-04-02
updated: 2026-04-02
assignee:
labels: [architecture, audit-2026-04-02-full]
audit_id: M13
---

# Split \_helpers.ts god module into focused files

## Summary

`server/routes/_helpers.ts` is 449 lines with 40+ exports spanning 5 distinct categories. Split into focused modules to reduce merge conflicts and improve maintainability.

## Background

Found during full audit 2026-04-02 (finding M13). The file bundles:

- Utility functions (parsing, formatting, premium checks)
- Rate limiter factory + 20 rate limiter instances
- Multer upload configuration
- Zod validation schemas
- Admin authorization

## Acceptance Criteria

- [ ] Rate limiters extracted to `server/routes/_rate-limiters.ts`
- [ ] Validation schemas extracted to `server/routes/_schemas.ts`
- [ ] Multer config extracted to `server/routes/_upload.ts`
- [ ] Admin auth extracted to `server/routes/_admin.ts`
- [ ] Generic utilities remain in `_helpers.ts`
- [ ] All 24 route files updated to import from correct new files
- [ ] All tests pass

## Implementation Notes

- This is a pure refactoring — no behavior changes
- Re-export everything from `_helpers.ts` temporarily to avoid breaking imports, then update importers

## Risks

- 24 route files need import updates — high risk of merge conflicts with in-progress work

## Updates

### 2026-04-02

- Deferred from full audit — large refactoring with no production risk
