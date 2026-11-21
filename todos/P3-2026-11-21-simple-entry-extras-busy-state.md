---
title: "Keep Simple Entry suggestion chips as buttons while estimating, and mark the extras input invalid"
status: backlog
priority: low
created: 2026-11-21
updated: 2026-11-21
assignee:
labels: [deferred, accessibility, client]
github_issue:
---

# Keep Simple Entry suggestion chips as buttons while estimating, and mark the extras input invalid

## Summary

Accessibility audit 2026-11-21 finding, deferred at triage by the owner (or a part of a fixed finding that needs a design call). Source: `docs/audits/2026-11-21-accessibility.md` (local manifest).

## Background

`client/components/meal-plan/SimpleEntryExtras.tsx:74, 111-123`: `onPress={busy ? undefined : …}` drops the chips to Chip's static branch, so they lose their button role and label mid-focus; the spinner has no name; the "Drink or side" input lacks `aria-invalid` while InlineError shows extraError.

## Acceptance Criteria

- [ ] Chips keep role button with accessibilityState.disabled while busy
- [ ] The spinner or the status is announced
- [ ] The extras input sets aria-invalid when extraError is shown

## Implementation Notes

Files: `client/components/meal-plan/SimpleEntryExtras.tsx` (and possibly Chip's disabled prop), tests.

## Updates

### 2026-11-21

- Filed from the accessibility audit
