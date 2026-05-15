---
title: "Extract roundToOneDecimal utility"
status: in-progress
priority: medium
created: 2026-04-07
updated: 2026-04-07
assignee:
labels: [code-quality, duplication]
---

# Extract roundToOneDecimal utility

## Summary

`Math.round(x * 10) / 10` appears 30+ times across 5 service files. Extract to a shared utility for clarity and consistency.

## Acceptance Criteria

- [ ] `roundToOneDecimal(n: number): number` in `shared/lib/math.ts` (or `server/lib/math.ts`)
- [ ] All 30+ occurrences replaced
- [ ] All tests pass

## Files affected

- `server/services/cooking-session.ts` (8 occurrences)
- `server/services/cooking-adjustment.ts` (10 occurrences)
- `server/services/verification-comparison.ts` (3 occurrences)
- `server/services/nutrition-lookup.ts` (8 occurrences)
- `server/services/glp1-insights.ts` (1 occurrence)

## Updates

### 2026-04-07

- Identified in full audit #6 (M14)
