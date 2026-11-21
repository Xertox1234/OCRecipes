---
title: "Announce notebook date changes and in-place state swaps"
status: backlog
priority: low
created: 2026-11-21
updated: 2026-11-21
assignee:
labels: [deferred, accessibility, client]
github_issue:
---

# Announce notebook date changes and in-place state swaps

## Summary

Accessibility audit 2026-11-21 finding, deferred at triage by the owner (or a part of a fixed finding that needs a design call). Source: `docs/audits/2026-11-21-accessibility.md` (local manifest).

## Background

Silent changes: NotebookEntryScreen follow-up date steps (~:500-545); ReportReplyButton reasons menu (:88-100); PlanWriteCard Swap has no expanded state (:201-208); OpeningBrief "Not today" (:74-77); NotebookScreen Yes/Remove (~:128-153, Remove has no undo); WeeklyReportScreen / WeeklyReportsScreen load errors (~:169-203 / 144-160).

## Acceptance Criteria

- [ ] Each change is announced (or exposed as state, e.g. expanded / accessibilityValue)
- [ ] Tests for each

## Implementation Notes

Files as listed.

## Updates

### 2026-11-21

- Filed from the accessibility audit
