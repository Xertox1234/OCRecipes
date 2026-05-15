---
title: "Fix getBarcodeNutrition N+1 sequential query loop"
status: backlog
priority: medium
created: 2026-03-27
updated: 2026-03-27
assignee:
labels: [performance, audit-2026-03-27-full]
audit_id: M12
---

# Fix getBarcodeNutrition N+1 sequential query loop

## Summary

`server/storage/api-keys.ts:160-168` queries barcode variants one at a time in a sequential loop. Should use `inArray()` in a single query.

## Acceptance Criteria

- [ ] Single query using `inArray(barcodeNutrition.barcode, variants)` with `.limit(1)`
- [ ] Priority ordering preserved (sort results by original variant order in JS)
- [ ] Existing tests pass

## Implementation Notes

- Use `inArray(barcodeNutrition.barcode, variants)` and sort results against the original `variants` array order

## Dependencies

- None

## Risks

- None — straightforward optimization

## Updates

### 2026-03-27

- Created from full audit finding M12
