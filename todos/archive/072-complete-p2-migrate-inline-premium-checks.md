---
title: "Migrate inline premium checks to checkPremiumFeature() helper"
status: pending
priority: p2
created: 2026-02-25
updated: 2026-02-25
assignee:
labels: [code-review, consistency, duplication]
---

# Migrate inline premium checks to checkPremiumFeature() helper

## Summary

4 route files duplicate the subscription lookup + tier validation + error response pattern instead of using the existing `checkPremiumFeature()` helper from `_helpers.ts`.

## Background

Found by: pattern-recognition-specialist (D1/F2)

Files with inline pattern: `meal-suggestions.ts`, `photos.ts`, `recipes.ts`, `chat.ts`. Additionally, `meal-suggestions.ts` omits `isValidSubscriptionTier()` before indexing TIER_FEATURES, which could theoretically throw on invalid tier values.

## Acceptance Criteria

- [ ] All 4 files migrated to use `checkPremiumFeature()` where applicable
- [ ] `meal-suggestions.ts` no longer directly indexes `TIER_FEATURES` without validation
- [ ] No duplicated subscription lookup logic remains

## Implementation Notes

The chat.ts case is slightly more complex — it needs the features object to check `dailyCoachMessages`. `checkPremiumFeature` already returns the features object, so it can be used directly.

## Updates

### 2026-02-25
- Created from code review (7-agent parallel review)
