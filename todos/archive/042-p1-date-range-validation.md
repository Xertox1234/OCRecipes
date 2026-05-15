---
title: "P1: Add date range validation and fix date arithmetic"
status: backlog
priority: high
created: 2026-02-06
updated: 2026-02-06
assignee:
labels: [data-integrity, performance, p1, meal-plan]
---

# P1: Add date range validation and fix date arithmetic

## Summary

The meal plan date range query accepts any YYYY-MM-DD strings without validating `start <= end`, maximum range, or calendar validity. The date boundary logic uses fragile timezone-dependent arithmetic.

## Background

- `server/routes.ts:2098-2125` — only validates regex format, not `start <= end`, valid calendar dates, or max range
- `server/storage.ts:819-825` — uses `new Date(endDate).getTime() + 24*60*60*1000` to make range inclusive, which is timezone-dependent and fragile
- A 10-year range query would scan massive result sets

## Acceptance Criteria

- [ ] Validate `start <= end` in the route handler
- [ ] Validate dates parse to valid calendar dates (reject `2024-13-45`)
- [ ] Add maximum range limit (e.g., 90 days)
- [ ] Replace fragile `lt(endDate + 1 day)` with `lte(endDate)` since `plannedDate` is a date column
- [ ] Add tests for edge cases (invalid dates, reversed range, oversized range)

## Implementation Notes

For date validation, `new Date(dateStr)` returns `Invalid Date` for truly invalid strings, but may accept some edge cases. Consider a stricter check:

```typescript
const d = new Date(start);
if (isNaN(d.getTime())) {
  /* invalid */
}
```

For the range query, simply use `lte()`:

```typescript
lte(mealPlanItems.plannedDate, endDate);
```

## Dependencies

- None

## Updates

### 2026-02-06

- Created from multi-agent code review of `feat/meal-planning-phase-1`
