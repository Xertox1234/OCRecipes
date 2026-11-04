---
title: "Verification streak in UTC days; micronutrient unit assumed"
status: backlog
priority: low
created: 2026-10-29
updated: 2026-10-31
assignee:
labels: [deferred, reliability]
github_issue:
---

# Verification streak in UTC days; micronutrient unit assumed

## Summary

Two small correctness edges from the cross-cutting audit pass.

## Background

Audit findings L-xc-2, L-xc-3. (1) `server/storage/verification.ts` (~97-100 `AT TIME ZONE 'UTC'`, ~131-139 `setUTCHours`) buckets the verification streak in UTC days, so a UTC-8 user's evening and next-morning verifications merge. (2) `server/services/micronutrient-lookup.ts` (~96-110) parses USDA `unitName` but never compares it to the configured unit — latent 1000× error if USDA ever returns µg for an mg nutrient.

Found by the 2026-10-29 pre-launch audit (manifest `docs/audits/2026-10-29-pre-launch.md`, local-only); deferred from the unattended overnight run because it needs a decision or verification that run could not make.

## Acceptance Criteria

- [ ] The streak uses the user's timezone (`users.timezone` / `parseTimezone`), per `docs/solutions/conventions/timezone-day-bucketing-threading-2026-06-10.md`
- [ ] Micronutrients with a mismatched unit are converted or skipped
- [ ] Tests for both

## Implementation Notes

## Scope Contract

- **Files in scope:** `server/storage/verification.ts`, `server/services/micronutrient-lookup.ts` and tests
- No new mechanisms, files, or abstractions beyond those listed.

## Updates

### 2026-10-29

- Initial creation (pre-launch audit, overnight run)

### 2026-10-31

- Decisions: the streak uses the user's stored timezone. For micronutrients, convert when the unit pair is known (µg / mg / g) and skip the value when the unit is unknown or mismatched in any other way.
