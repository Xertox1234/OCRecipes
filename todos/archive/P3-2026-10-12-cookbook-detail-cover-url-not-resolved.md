---
title: "Cookbook detail cover image skips resolveImageUrl"
status: done
priority: low
created: 2026-10-12
updated: 2026-10-12
assignee:
labels: [deferred, ui]
github_issue:
---

# Cookbook detail cover image skips resolveImageUrl

## Summary

PR #1417 added the cookbook's cover image to the top of CookbookDetail, but it passes `cookbook.coverImageUrl` straight to `FallbackImage`. Every other place that shows a cover resolves it first, so a relative cover path shows a blank image here.

## Background

Found by the orchestrator while reviewing PR #1417 (QA sweep #26). `saveCookbookCover` (`server/lib/image-store.ts:195-197`) returns an absolute R2 URL when R2 is configured, which is the case in production. Without R2 (local dev, or legacy rows) it writes to disk and returns a relative path. `CookbookListScreen.tsx:106` and `CookbookCoverPlate.tsx:76` both call `resolveImageUrl`; the new code in `CookbookDetailScreen.tsx` does not. This is the same bug class as the blank TastePicks tiles fixed in #1413.

## Acceptance Criteria

- [x] CookbookDetail's cover uses `resolveImageUrl(cookbook.coverImageUrl)`.
- [x] The cover sets `accessibilityIgnoresInvertColors`, like the recipe thumbnails on the same screen.
- [x] A test covers a relative cover path.

## Implementation Notes

- `client/screens/meal-plan/CookbookDetailScreen.tsx`: the `FallbackImage` in `ListHeaderComponent`.
- `resolveImageUrl` lives in `client/lib/query-client.ts`.

## Scope Contract

- **Mechanisms to use:** the existing `resolveImageUrl`.
- **Files in scope:** `client/screens/meal-plan/CookbookDetailScreen.tsx` and its `__tests__`.
- No new mechanisms.

## Dependencies

- PR #1417 merged.

## Updates

### 2026-10-12

- Filed while reviewing PR #1417.

### 2026-10-12 (fixed)

- The cover goes through `resolveImageUrl` and sets `accessibilityIgnoresInvertColors`; a test renders a relative cover path and expects the absolute URL.
- Also fixed on the same screen: the recipe thumbnails passed `item.imageUrl` raw too (the server returns it unchanged, and recipe images can be relative). They now use `resolveImageUrl`, with a test.
