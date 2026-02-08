---
title: "P3: Consolidate TabChip/FilterChip into existing Chip component"
status: backlog
priority: low
created: 2026-02-06
updated: 2026-02-06
assignee:
labels: [code-quality, p3, meal-plan, cleanup]
---

# P3: Consolidate TabChip/FilterChip into existing Chip component

## Summary

`RecipeBrowserScreen` defines two near-identical chip components (`TabChip` and `FilterChip`) that duplicate the existing `client/components/Chip.tsx`.

## Background

`client/screens/meal-plan/RecipeBrowserScreen.tsx:56-128` — both components are Pressable + ThemedText with active/inactive styling, differing only in color opacity and border. The existing `Chip` component already handles this pattern.

## Acceptance Criteria

- [ ] Replace `TabChip` and `FilterChip` with the existing `Chip` component (or extend it if needed)
- [ ] ~35 lines removed from RecipeBrowserScreen
- [ ] Visual appearance preserved

## Dependencies

- None

## Updates

### 2026-02-06

- Created from multi-agent code review of `feat/meal-planning-phase-1`
