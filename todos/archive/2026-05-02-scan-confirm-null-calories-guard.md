---
title: "Block Log It when barcode lookup fails with no nutrition data"
status: backlog
priority: low
created: 2026-05-02
updated: 2026-05-02
assignee:
labels: [deferred, audit-2026-05-02, data-integrity]
---

# Block Log It when barcode lookup fails with no nutrition data

## Summary

When the barcode lookup fails, `.catch()` sets `name: "Food item"` and `calories: null`, but the user can still tap Log It. This stores a barcode-linked row with no nutrition data, inflating item count without contributing to daily calorie totals.

## Background

Deferred from 2026-05-02 full audit (finding L3). `client/screens/ScanScreen.tsx` lines 199-207. The design intent is unclear: should a failed lookup block logging entirely, or allow logging with a name prompt?

## Acceptance Criteria

- [ ] On lookup failure, the overlay either: (a) disables "Log It" and shows "Nutrition data unavailable", or (b) hides the overlay and falls back to the normal NutritionDetail flow

## Implementation Notes

Option (a) is simplest: set an `isError: boolean` field on the confirm card and render "Nutrition data unavailable" with a disabled Log It button. Option (b) is more disruptive.

## Dependencies

- None

## Risks

- Product direction choice — "always allow logging even without nutrition" vs "require data" — check with product owner

## Updates

### 2026-05-02

- Initial creation (deferred from audit L3)
