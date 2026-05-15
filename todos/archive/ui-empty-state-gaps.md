---
title: "Fill empty state gaps across screens"
status: backlog
priority: medium
created: 2026-04-12
updated: 2026-04-12
assignee:
labels: [ui, ux, polish]
---

# Fill Empty State Gaps

## Summary

Several screens lack proper empty state handling using the `EmptyState` component. Add appropriate empty states with contextual icons, messaging, and call-to-action buttons.

## Background

The `EmptyState` component (`client/components/EmptyState.tsx`) supports variants ("firstTime", "normal"), icons, titles, descriptions, and action buttons. It's used in ~16 files but missing from several screens that can be empty.

## Acceptance Criteria

- [ ] PantryScreen: "Your pantry is empty" with "Add Items" CTA
- [ ] CookbookDetailScreen: "This cookbook is empty" with "Add Recipes" CTA
- [ ] WeightTrackingScreen: "No weight entries yet" with "Log Weight" CTA
- [ ] FastingScreen: "No fasting history" with "Start Fast" CTA
- [ ] GroceryListScreen (all checked): celebratory "All done!" state with success animation
- [ ] RecipeBrowserScreen (no results): "No recipes match your search" with "Clear Filters" CTA
- [ ] All empty states use `EmptyState` component (not custom inline layouts)
- [ ] All empty states use `FadeInUp` entrance animation (respecting `reducedMotion`)
- [ ] Tests pass

## Implementation Notes

- Use existing `EmptyState` component with appropriate `variant` prop
- Icons should match the screen's domain (e.g., "shopping-bag" for pantry, "book" for cookbook)
- The "all items checked" GroceryListScreen state is a special celebratory variant — consider a success-themed color or a brief confetti-style animation
- ChatListScreen already has a custom empty state (not using `EmptyState` component) — consider migrating

## Dependencies

- None — `EmptyState` component already exists

## Risks

- Need to verify each screen's actual empty condition (some may never be empty in practice)
- Celebratory grocery completion state needs design review

## Updates

### 2026-04-12

- Initial creation during UI improvement audit
