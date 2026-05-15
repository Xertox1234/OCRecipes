---
title: "Transition recent actions from icon+label to icon-only"
status: done
priority: low
created: 2026-03-19
updated: 2026-03-19
assignee:
labels: [home, ux]
---

# Recent Actions Icon+Label to Icon-Only Transition

## Summary

The recent actions row currently always shows icon+label chips. Per the design spec, it should transition to icon-only after the user is familiar enough with the icons.

## Acceptance Criteria

- [x] Track usage count per action in AsyncStorage
- [x] After N uses (e.g., 5), switch that action's chip to icon-only
- [x] Ensure icon-only chips still have `accessibilityLabel` for screen readers

## Implementation Notes

Add a usage counter to `home-actions-storage.ts` alongside the recent actions array. `RecentActionsRow` reads the count and conditionally hides the label. Keep the threshold low (5-10 uses) so the transition happens naturally.
