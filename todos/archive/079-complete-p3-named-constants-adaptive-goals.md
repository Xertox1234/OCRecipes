---
title: "Extract named constants for magic numbers in adaptive-goals.ts"
status: pending
priority: p3
created: 2026-02-25
updated: 2026-02-25
assignee:
labels: [code-review, readability]
---

# Extract named constants for magic numbers in adaptive-goals.ts

## Summary

Magic numbers like 7700, -500, 300, 1200, 5000 in `server/services/adaptive-goals.ts` should be named constants for readability.

## Background

Found by: architecture-strategist

## Acceptance Criteria

- [ ] Named constants: KCAL_PER_KG, WEIGHT_LOSS_DEFICIT, WEIGHT_GAIN_SURPLUS, MIN_SAFE_CALORIES, MAX_SAFE_CALORIES

## Updates

### 2026-02-25
- Created from code review (7-agent parallel review)
