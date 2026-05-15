---
title: "Rename or fix `upsertBarcodeNutrition` — current impl is insert-if-absent, not upsert"
status: in-progress
priority: medium
created: 2026-05-11
updated: 2026-05-11
assignee:
labels: [database, refactor, deferred]
github_issue:
---

# Rename or fix upsertBarcodeNutrition

## Summary

`server/storage/api-keys.ts::upsertBarcodeNutrition` is named "upsert" but uses `onConflictDoNothing()`, meaning the existing row is never updated. Callers expecting standard upsert semantics (newer-data-wins) will silently fail to persist corrected nutrition data — a data-integrity hazard for the verified-product DB pipeline.

## Background

Surfaced by kimi-review during implementation of `todos/2026-05-11-storage-tests-critical.md`. The test `does NOT overwrite existing data on conflict (idempotent insert)` explicitly documents the first-write-wins behavior, so the contract is preserved — but the name continues to mislead.

Decide between two corrections:

1. **Rename**: `insertBarcodeNutritionIfAbsent` (preserves current behavior, clarifies semantics). All call sites in `server/services/nutrition-lookup.ts` (and any others) must be updated.
2. **Change implementation**: switch to `onConflictDoUpdate` with newest-source-wins or recency-weighted semantics, and update the test to assert the new behavior.

Rename is the surgical option. Implementation change has downstream policy implications (which source wins, how recency is decided) and is a bigger conversation.

## Acceptance Criteria

- [ ] Function in `server/storage/api-keys.ts` either renamed to reflect insert-if-absent semantics, OR re-implemented with `onConflictDoUpdate` and explicit conflict-resolution policy
- [ ] All call sites updated (grep `upsertBarcodeNutrition`)
- [ ] Existing test in `server/storage/__tests__/api-keys.test.ts` (the `does NOT overwrite existing data on conflict` test) updated to match the new contract
- [ ] No silent behavior change — if renaming, behavior is preserved; if re-implementing, callers reviewed for assumptions

## Implementation Notes

- Existing callers (best guess, verify with grep): `server/services/nutrition-lookup.ts` cache writes. Confirm before changing.
- `getBarcodeNutrition` is the read side and is fine as-is.
- If renaming, the existing test name "does NOT overwrite existing data on conflict (idempotent insert)" already telegraphs the rename.

## Dependencies

None.

## Risks

- Rename is mechanical but touches multiple files; ensure no string references to the old name in logs or telemetry.
- Implementation change could shift cache-staleness behavior — get sign-off if going this route.

## Updates

### 2026-05-11

- Created during kimi-review of `todos/2026-05-11-storage-tests-critical.md` implementation
