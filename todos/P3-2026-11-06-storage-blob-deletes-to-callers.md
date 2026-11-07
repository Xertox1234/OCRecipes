---
title: "Decide: should storage modules call R2 deleteImage, or return keys for the caller to delete?"
status: backlog
priority: low
created: 2026-11-06
updated: 2026-11-06
assignee:
labels: [deferred, architecture]
github_issue:
---

# Storage-layer R2 deletes

## Summary

Three storage modules make R2 network calls (`deleteImage`):

- `server/storage/community-recipes.ts` (~231, ~448)
- `server/storage/cookbook-cover-candidates.ts:124`
- `server/storage/account-images.ts:159-163`

This is finding L4 from the 2026-11-06 architecture audit. It's contested, so it needs a decision before any code changes.

## Background

- `storage → lib` is an allowed edge, and `deleteImagesIfUnreferenced` is a deliberate safety filter: it keeps one user's crafted image URL from deleting another user's image.
- Against that, external I/O in the data layer means storage tests need R2 mocked, and the "delete DB rows before blobs" ordering (`docs/solutions/design-patterns/delete-db-rows-before-blobs-and-respect-in-flight-work-2026-10-13.md`) is enforced only by convention, separately in each place.
- The "storage returns keys, caller deletes" pattern already exists: `inspired-suggestions` returns `RETURNING {id, imageUrl}` and the script deletes.

## Acceptance Criteria

- [ ] Owner decides: keep deletes in storage, documented as an allowed exception in `docs/rules/architecture.md`, or move them to callers
- [ ] If moving: the storage functions return the removed keys, one service owns `deleteImagesIfUnreferenced` and the fire-and-forget delete, and the cross-user filter tests still pass

## Implementation Notes

- Files: the three storage modules above, plus their route callers (`server/routes/auth.ts` account deletion, meal-plan update and delete, cookbook cover).
