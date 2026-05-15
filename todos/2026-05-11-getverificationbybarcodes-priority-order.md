---
title: "getVerificationByBarcodes should respect variant array priority order"
status: backlog
priority: low
created: 2026-05-11
updated: 2026-05-11
assignee:
labels: [deferred, database, data-integrity]
github_issue:
---

# getVerificationByBarcodes should respect variant array priority order

## Summary

`getVerificationByBarcodes` in `server/storage/verification.ts` uses
`WHERE barcode IN (...)` with `LIMIT 1` and no `ORDER BY`. When multiple
variants exist in the DB, the row returned is arbitrary (PG-implementation
defined). The sibling function `getBarcodeNutrition` in
`server/storage/api-keys.ts` sorts results by array index in-memory and
returns the highest-priority match. The two should agree.

## Background

Surfaced by kimi-review during the storage-tests-critical todo
(`todos/archive/2026-05-11-storage-tests-critical.md`). The current test
file (`server/storage/__tests__/verification.test.ts`, the
`getVerificationByBarcodes` describe block) documents the
non-determinism in a comment but does not assert priority order because
the production function does not provide it.

If variants ever map to different products this is a data-integrity risk:
two clients with the same variant list could see different products.

## Acceptance Criteria

- [ ] `getVerificationByBarcodes` in `server/storage/verification.ts`
      returns the row matching the highest-priority variant (earliest in
      the variants array), matching `getBarcodeNutrition`'s contract
- [ ] Test in `server/storage/__tests__/verification.test.ts` is updated
      to assert array-order priority (seed two barcodes, request in both
      orders, confirm each returns the first-position match)
- [ ] No regression in existing callers — search for production usages
      and confirm none depend on the current arbitrary order

## Implementation Notes

Mirror the pattern in `getBarcodeNutrition` (`server/storage/api-keys.ts:164-182`):
fetch all matches with `inArray`, then sort in-memory by variant array
position, return `results[0]`.

## Dependencies

None.

## Risks

- Production callers might (incorrectly) rely on the arbitrary order;
  audit before changing.
