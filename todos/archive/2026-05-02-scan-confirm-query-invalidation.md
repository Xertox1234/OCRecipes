---
title: "Invalidate dailySummary/scannedItems after confirm-overlay log"
status: in-progress
priority: medium
created: 2026-05-02
updated: 2026-05-02
assignee:
labels: [deferred, audit-2026-05-02, architecture]
---

# Invalidate dailySummary/scannedItems after confirm-overlay log

## Summary

`handleConfirmLog` in `ScanScreen.tsx` POSTs to `/api/scanned-items` but never calls `queryClient.invalidateQueries`. The Home screen nutrition ring stays stale after a scan-and-log flow using the confirm overlay (returnAfterLog mode).

## Background

Deferred from 2026-05-02 full audit (finding M1). When the user scans a barcode and taps "Log It" on the confirm overlay, the item is persisted but `dailySummary` and `scannedItems` query caches are never invalidated, so the Home ring doesn't reflect the new entry until the next natural refetch or app backgrounding.

## Acceptance Criteria

- [ ] `handleConfirmLog` calls `queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dailySummary })` after a successful POST
- [ ] `handleConfirmLog` calls `queryClient.invalidateQueries({ queryKey: QUERY_KEYS.scannedItems })` after a successful POST
- [ ] Home nutrition ring updates immediately after logging via confirm overlay

## Implementation Notes

`ScanScreen.tsx` around line 223-242. Add `useQueryClient()` hook (already imported in `useQuickLogSession`, but not in ScanScreen itself) and invalidate both keys in the `try` block after `refreshScanCount()`.

## Dependencies

- None

## Risks

- None — standard TanStack Query invalidation pattern

## Updates

### 2026-05-02

- Initial creation (deferred from audit M1)
