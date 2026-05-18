---
title: "Implement confidence-based OCR fallback in mergeReceiptItems"
status: done
priority: medium
created: 2026-05-16
updated: 2026-05-16
assignee:
labels: [deferred, camera]
github_issue:
---

# Implement confidence-based OCR fallback in mergeReceiptItems

## Summary

`mergeReceiptItems` in `client/screens/receipt-review-utils.ts` ignores its `_local` parameter and always returns the AI items unchanged. Its docstring promises a confidence-based fallback to locally-parsed OCR items that was never implemented.

## Background

Surfaced by the 2026-05-16 unfinished-features audit (finding M2, code-quality). Deferred from the fix phase because it is a genuine design task, not a wiring fix: the two item shapes are not interconvertible and there is no correspondence key between them.

- `LocalReceiptItem` (`@/lib/receipt-ocr-parser`) is a raw OCR skeleton: `{ rawName, price, quantity }` — no `name`, `category`, `isFood`, `estimatedShelfLifeDays`, or `confidence`.
- `ReceiptItem` (`@/hooks/useReceiptScan`) is the fully-classified AI shape with a `confidence` field.
- The local and AI arrays have no shared id/index correspondence, so "for any low-confidence AI item, fall back to the local item" has no defined mapping.

## Acceptance Criteria

- [ ] Decide the correspondence strategy between local and AI items (index, fuzzy name match against `rawName`, or none)
- [ ] Define a confidence threshold below which the AI item is replaced/augmented
- [ ] Decide how a `LocalReceiptItem` becomes a renderable `ReceiptItem` (which fields are synthesized)
- [ ] Implement, or — if no clean design exists — drop the `_local` parameter and the misleading docstring instead
- [ ] Update `client/screens/__tests__/receipt-review-utils.test.ts`

## Implementation Notes

- Caller: `client/screens/ReceiptReviewScreen.tsx:136` — `mergeReceiptItems(localItemsRef.current, result.items)`.
- `shouldReplaceWithAIReceipt` in the same file already does a coarse local-vs-AI decision; consider whether per-item fallback adds enough value over the existing whole-result swap.

## Dependencies

- None external — but blocked on a design decision.

## Risks

- May conclude the cleanest outcome is removing `_local` entirely rather than implementing a fragile fuzzy match.

## Updates

### 2026-05-16

- Initial creation (audit 2026-05-16-unfinished-features, finding M1)

### 2026-05-17

- Resolved via the "drop it" path authorized by acceptance criterion #4.
  No clean correspondence key exists between `LocalReceiptItem` and
  `ReceiptItem`, and AI name expansion makes fuzzy `rawName` matching
  unreliable. `mergeReceiptItems` also only runs after
  `shouldReplaceWithAIReceipt` has already decided the AI result wins, so a
  per-item fallback would contradict that whole-result decision.
- Dropped the unused `_local` parameter, replaced the misleading TODO
  docstring with a rationale comment, updated the caller and tests.
