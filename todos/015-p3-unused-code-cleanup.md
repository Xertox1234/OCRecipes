---
title: "Remove unused exports and dead code"
status: backlog
priority: low
created: 2026-02-24
updated: 2026-02-24
assignee:
labels: [refactor, code-review, cleanup]
---

# Remove Unused Exports and Dead Code

## Summary

Several hook exports, service functions, and data fields are defined but never imported or used anywhere.

## Background

Unused items found:
- `useUpdateMedicationLog()` in useMedication.ts:63
- `useDeleteMedicationLog()` in useMedication.ts:91
- `useToggleGlp1Mode()` in useMedication.ts:119
- `useExerciseSummary()` in useExerciseLogs.ts:41
- `screenReaderEnabled` in useAccessibility.ts:30
- `getTypicalServing()` in cultural-food-map.ts:543
- `getSupportedCuisines()` in cultural-food-map.ts:551
- `avg30Day` computed in weight-trend.ts but never rendered
- Empty styles: `endButton: {}` in FastingScreen, `section: {}` in GLP1CompanionScreen
- Duplicate section header in schema.ts lines 924-929

## Acceptance Criteria

- [ ] All unused exports removed
- [ ] Empty style objects removed
- [ ] Duplicate schema section header removed
- [ ] ~70 lines eliminated

## Updates

### 2026-02-24
- Found by code-simplicity agent
