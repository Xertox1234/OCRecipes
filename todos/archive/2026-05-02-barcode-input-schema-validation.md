---
title: "Add format/length validation to scannedItemInputSchema barcode + productName"
status: done
priority: low
created: 2026-05-02
updated: 2026-05-02
assignee:
labels: [deferred, audit-2026-05-02, security]
---

# Add format/length validation to scannedItemInputSchema

## Summary

`barcode` in `scannedItemInputSchema` has no format validation (no digit-only regex, no length cap). `productName` has `.min(1)` but no `.max()`. Both issues allow malformed or overlong values to reach the DB.

## Background

Deferred from 2026-05-02 full audit (findings L1 + L2). The `GET /api/nutrition/barcode/:code` endpoint correctly enforces `^\d+$` and length ≤50 (line 92 of `nutrition.ts`), but the corresponding `POST /api/scanned-items` schema at lines 28-42 does not enforce the same constraints on `barcode`.

## Acceptance Criteria

- [ ] `barcode` field: `.regex(/^\d+$/).max(50)` (matching the GET endpoint guard)
- [ ] `productName` field: `.max(256)` (or a consistent cap matching other schemas)
- [ ] Existing tests continue to pass; add a test case for oversized/invalid barcode

## Implementation Notes

`server/routes/nutrition.ts` lines 28-42. Check what cap other `productName` fields use across schemas before picking 256.

## Dependencies

- None

## Risks

- None — additive validation only

## Updates

### 2026-05-02

- Initial creation (deferred from audit L1 + L2)
