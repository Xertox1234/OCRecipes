---
title: "getScannedItemsByIds drops the owner filter when userId is missing"
status: done
priority: low
created: 2026-11-27
updated: 2026-11-27
assignee:
labels: [deferred, server, security]
github_issue:
---

# getScannedItemsByIds drops the owner filter when userId is missing

## Summary

`getScannedItemsByIds(ids, userId?)` only adds `user_id = …` when `userId`
is truthy, so a future caller that passes `undefined` or `""` would read any
user's scans.

## Background

Found by the security review of the Coach T4 compare-card PR. Deferred
because nothing is exposed today: both callers pass the authenticated id
(the compare card and the micronutrients route), and the fix changes a
shared storage signature outside that PR's scope.

## Implementation Notes

In scope:

- `server/storage/nutrition.ts:92` — make `userId` required for this read
  (add a separately named function if an internal caller truly needs every
  user's rows).
- `server/storage/index.ts:177` — the facade entry.
- `server/routes/micronutrients.ts:113` and
  `server/services/label-compare.ts:33` — the two callers.

## Acceptance Criteria

- [x] No user-facing caller can read scans without an owner filter.
- [x] A test pins that the read never returns another user's scan.

## Updates

- 2026-11-27: `userId` is now required and the owner filter always applies; an empty id returns no rows. Both callers already pass the signed-in id. Test: `server/storage/__tests__/nutrition.test.ts` → "never returns another user's scan, even for an empty owner id".
