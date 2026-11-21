---
title: "Decide on the week grid's 1.2x text-size cap"
status: backlog
priority: low
created: 2026-11-21
updated: 2026-11-21
assignee:
labels: [deferred, accessibility, client, product-decision]
github_issue:
---

# Decide on the week grid's 1.2x text-size cap

## Summary

Accessibility audit 2026-11-21 finding, deferred at triage by the owner (or a part of a fixed finding that needs a design call). Source: `docs/audits/2026-11-21-accessibility.md` (local manifest).

## Background

`client/components/meal-plan/WeekGridCell.tsx:27-39` (`GRID_MAX_FONT_SCALE = 1.2`, 10-11pt text, 100pt cells) and `WeekGrid.tsx` cap Dynamic Type at 1.2x. Screen readers get full labels and the day screen shows full text, but a sighted large-text user sees truncated titles with no hint. A deliberate trade-off — owner call.

## Acceptance Criteria

- [ ] Owner decides: raise the cap, add a visible route to full text, or document the exception
- [ ] If changed, check the grid at the largest accessibility sizes on both platforms

## Implementation Notes

Files: `client/components/meal-plan/WeekGridCell.tsx`, `client/components/meal-plan/WeekGrid.tsx`.

## Updates

### 2026-11-21

- Filed from the accessibility audit
