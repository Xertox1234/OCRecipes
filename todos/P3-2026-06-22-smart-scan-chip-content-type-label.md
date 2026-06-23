---
title: "Smart-scan confirmation chip shows 'Food detected' for non-food content types"
status: backlog
priority: low
created: 2026-06-22
updated: 2026-06-22
assignee:
labels: [deferred, rn-ui-ux]
github_issue:
---

# Smart-scan confirmation chip shows "Food detected" for non-food content types

## Summary

The smart-scan `SMART_CONFIRMED` confirmation chip (`ProductChip`, `variant === "smart_photo"`) falls back to the literal "Food detected" whenever the classifier returns an empty `foods[]` — which is now the case for restaurant menus (after PR-A wired menus to the dedicated menu-scan pipeline), and was already the case for receipts and raw-ingredient content types that resolve to a classification-only result. The label should reflect the detected `contentType`.

## Background

Surfaced during PR-A (`fix/activate-menu-scanner`) review as a Low finding. Before PR-A, restaurant menus were (wrongly) analyzed with `LOG_PROMPT`, which populated `foods[]` with hallucinated dish names — so the chip showed a (bogus) food name. PR-A correctly makes menus return classification-only (`foods: []`), so the chip now shows the generic "Food detected" fallback for menus. This is consistent with how receipts/raw-ingredients already behave, but it's the user's first feedback point in the smart-scan flow and reads as inaccurate when holding a menu/receipt.

Not a blocker for PR-A (the routing + premium gating are correct); purely a label-accuracy polish.

## Acceptance Criteria

- [ ] When `phase.classification.foods` is empty, the chip label reflects `phase.classification.contentType` (e.g. "Menu detected", "Receipt detected", "Ingredients detected") instead of "Food detected".
- [ ] Existing food-bearing classifications (prepared_meal, etc.) still show `foods[0].name`.
- [ ] A `CONTENT_TYPE_LABELS`-style mapping is reused if one already exists (see `client/screens/scan-screen-utils.ts` `CONTENT_TYPE_LABELS`) rather than introducing a parallel map.

## Implementation Notes

- File: `client/camera/components/ProductChip.tsx` (~line 229) — the `{phase.classification.foods[0]?.name ?? "Food detected"}` fallback.
- `client/screens/scan-screen-utils.ts` already exports `getContentTypeLabel(contentType)` / `CONTENT_TYPE_LABELS` — reuse it for the fallback string instead of a new map.
- Extract the label-selection into a small pure helper so it can be unit-tested (matches the codebase's `*-utils.ts` testable-extraction pattern).

## Dependencies

- None. PR-A (`fix/activate-menu-scanner`) introduces the menu case but the receipt/raw-ingredient cases predate it.
