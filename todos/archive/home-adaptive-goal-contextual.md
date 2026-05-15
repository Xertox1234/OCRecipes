---
title: "Show Adaptive Goal Card contextually in nutrition actions"
status: done
priority: low
created: 2026-03-19
updated: 2026-03-19
assignee:
labels: [home, goals, premium]
---

# Show Adaptive Goal Card Contextually

## Summary

The Adaptive Goal Card was removed from the home page during the redesign. It should now appear contextually when users open nutrition-related screens (Quick Log, daily detail view).

## Acceptance Criteria

- [x] AdaptiveGoalCard appears on Quick Log screen when a recommendation is available
- [ ] AdaptiveGoalCard appears on daily nutrition detail screen (when built)
- [x] Only shown for premium users
- [x] Accept/dismiss behavior unchanged

## Implementation Notes

`AdaptiveGoalCard` component still exists — it just needs to be imported into the appropriate screens. Uses `useAdaptiveGoals` hook.
