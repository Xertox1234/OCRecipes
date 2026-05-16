---
title: "Add user measurement-unit preference (weight displayed always in lbs)"
status: backlog
priority: low
created: 2026-05-16
updated: 2026-05-16
assignee:
labels: [deferred, database]
github_issue:
---

# Add user measurement-unit preference (weight displayed always in lbs)

## Summary

`server/services/profile-hub.ts:54` hardcodes `unit: "lbs"` for the latest-weight payload. There is no user measurement-unit preference, so weight always displays in imperial regardless of locale or user choice.

## Background

Surfaced by the 2026-05-16 unfinished-features audit (finding L1, code-quality). Deferred from the fix phase because there is no unit-preference system to read from — building one is a feature, not a one-line fix. It needs a schema column, a settings UI surface, and a migration.

## Acceptance Criteria

- [ ] Add a measurement-unit preference column (e.g. `users.measurementUnit` — `"imperial" | "metric"`)
- [ ] Add a settings UI control to change it
- [ ] Read the preference in `profile-hub.ts` instead of the hardcoded `"lbs"`
- [ ] Audit other weight/height display sites for the same hardcoding
- [ ] Migration handles existing rows (default to imperial to preserve current behavior)

## Implementation Notes

- Hardcode site: `server/services/profile-hub.ts:54`.
- `users` table stores `weight`/`height` as decimals — confirm the stored unit so conversion is correct.
- Weight tracking and goal-setup screens also display weight — they need the same treatment.

## Dependencies

- Schema migration (`npm run db:push`)

## Risks

- Stored weight unit ambiguity — must confirm what unit the DB decimal represents before adding display conversion.

## Updates

### 2026-05-16

- Initial creation (audit 2026-05-16-unfinished-features, finding L1)
