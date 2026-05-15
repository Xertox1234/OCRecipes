---
title: "Add user-facing micronutrient display"
status: done
priority: medium
created: 2026-03-20
updated: 2026-03-24
assignee:
labels: [ui, nutrition, micronutrients]
---

# Add User-Facing Micronutrient Display

## Summary

The `micronutrient-lookup.ts` service and `micronutrientCache` table exist but no UI surfaces micronutrient data to users. Users can only see macros (calories, protein, carbs, fat).

## Background

The backend can look up micronutrients (vitamins, minerals) for scanned foods and caches results. This data is collected but never shown. Displaying micronutrients would add depth to the nutrition tracking experience — users could see vitamin/mineral intake, not just macros.

## Acceptance Criteria

- [x] Micronutrient data visible on `NutritionDetailScreen` for individual items
- [x] Shows key micronutrients: vitamins (A, C, D, B12, etc.), minerals (iron, calcium, potassium, etc.)
- [x] Values shown as amount + % daily value where applicable
- [x] Graceful handling when micronutrient data is unavailable (not all items have it)
- [x] Clear visual hierarchy — macros remain primary, micros are supplementary

## Implementation Notes

- `micronutrient-lookup.ts` already fetches and caches data
- `micronutrientCache` table stores results
- May need a new API endpoint or extend existing nutrition detail endpoint to include micros
- Consider a collapsible "Micronutrients" section on NutritionDetailScreen to avoid clutter
- Daily totals for micronutrients would be a follow-up feature

## Dependencies

- Micronutrient lookup service (exists)
- Micronutrient cache table (exists)

## Risks

- Data availability varies by source — some items may have sparse micronutrient data
- UI clutter if not designed carefully — keep it secondary to macros

## Updates

### 2026-03-20

- Initial creation from feature audit
