---
title: "Stop switch rows from reading their label twice"
status: backlog
priority: low
created: 2026-11-21
updated: 2026-11-21
assignee:
labels: [deferred, accessibility, client]
github_issue:
---

# Stop switch rows from reading their label twice

## Summary

Accessibility audit 2026-11-21 finding, deferred at triage by the owner (or a part of a fixed finding that needs a design call). Source: `docs/audits/2026-11-21-accessibility.md` (local manifest).

## Background

`client/components/profile/InlineSettings.tsx` (~:86-111, "Plan for my family") and `client/screens/WeeklyReportsScreen.tsx:67-102`: the visible label text is its own stop next to a Switch with the same accessibilityLabel; the weekly push switch's disabled reason lives only in the hint.

## Acceptance Criteria

- [ ] One focus stop per switch row, carrying label, state and any disabled reason
- [ ] Tapping the row text toggles, or the text is hidden

## Implementation Notes

Files as listed, tests.

## Updates

### 2026-11-21

- Filed from the accessibility audit
