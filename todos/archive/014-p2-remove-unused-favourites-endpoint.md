---
title: "Remove unused GET /api/scanned-items/favourites endpoint"
status: backlog
priority: medium
created: 2026-02-27
updated: 2026-02-27
assignee:
labels: [yagni, server, tech-debt, pr-10-review]
---

# Remove Unused Favourites List Endpoint

## Summary

`GET /api/scanned-items/favourites` and its storage method `getFavouriteScannedItems()` are dead code — no client code calls this endpoint. This is a YAGNI violation (~70 lines). Remove and re-add when a Favourites screen is built.

## Affected Code

- **Route handler:** `server/routes/nutrition.ts` — `GET /api/scanned-items/favourites` (~25 lines)
- **Storage method:** `server/storage/nutrition.ts` — `getFavouriteScannedItems()` (~45 lines)
- **Interface:** `server/storage/index.ts` — `IStorage.getFavouriteScannedItems` entry

## Acceptance Criteria

- [ ] Route handler removed
- [ ] Storage method removed
- [ ] IStorage interface entry removed
- [ ] No client code references this endpoint (already confirmed by grep)
- [ ] All existing tests pass
- [ ] If tests exist for this endpoint, remove or archive them

## Implementation Notes

The toggle endpoint (`POST /api/scanned-items/:id/favourite`) and the `isFavourited` field on list items are sufficient for the current feature. A dedicated favourites list endpoint should be added in the PR that introduces the Favourites screen.

## Dependencies

- None

## Risks

- None — removing dead code

## Updates

### 2026-02-27
- Created from PR #10 code review (found by code-simplicity-reviewer)
