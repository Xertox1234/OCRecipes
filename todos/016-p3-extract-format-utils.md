---
title: "Extract formatDate and formatDuration to shared utility"
status: backlog
priority: low
created: 2026-02-24
updated: 2026-02-24
assignee:
labels: [refactor, code-review, dry]
---

# Extract Format Utilities

## Summary

`formatDate` and `formatDuration` are duplicated across FastingScreen, WeightTrackingScreen, MealPlanHomeScreen, and ItemDetailScreen.

## Acceptance Criteria

- [ ] `client/lib/format.ts` with shared formatting functions
- [ ] All 4+ screens import from shared util
- [ ] ~30 lines of deduplication

## Updates

### 2026-02-24
- Found by code-simplicity agent
