---
title: "Decide on the week grid's 1.2x text-size cap"
status: backlog
priority: low
created: 2026-11-21
updated: 2026-11-22
assignee:
labels: [deferred, accessibility, client]
github_issue:
---

# Decide on the week grid's 1.2x text-size cap

## Summary

Accessibility audit 2026-11-21 finding, deferred at triage by the owner (or a part of a fixed finding that needs a design call). Source: `docs/audits/2026-11-21-accessibility.md` (local manifest).

## Background

`client/components/meal-plan/WeekGridCell.tsx:27-39` (`GRID_MAX_FONT_SCALE = 1.2`, 10-11pt text, 100pt cells) and `WeekGrid.tsx` cap Dynamic Type at 1.2x. Screen readers get full labels and the day screen shows full text, but a sighted large-text user sees truncated titles with no hint. A deliberate trade-off — owner call.

## Acceptance Criteria

- [ ] The cap is documented as a deliberate exception (code comment at GRID_MAX_FONT_SCALE and a line in the relevant docs/solutions or rules note)
- [ ] A sighted large-text user can tell that tapping a day shows the full text (e.g. a visible affordance or hint on the grid)
- [ ] No change to cell size or the 7-column layout

## Implementation Notes

Files: `client/components/meal-plan/WeekGridCell.tsx`, `client/components/meal-plan/WeekGrid.tsx`.

## Updates

### 2026-11-21

- Filed from the accessibility audit

### 2026-11-22

- Owner decision: keep the 1.2x cap, record it as a deliberate exception, and make the route to full-size text (tapping a day) obvious.
