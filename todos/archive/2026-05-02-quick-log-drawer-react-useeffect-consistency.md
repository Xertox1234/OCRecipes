---
title: "Normalize React.useEffect vs useEffect in QuickLogDrawer"
status: in-progress
priority: low
created: 2026-05-02
updated: 2026-05-02
assignee:
labels: [deferred, audit-2026-05-02, code-quality]
---

# Normalize React.useEffect vs useEffect in QuickLogDrawer

## Summary

`QuickLogDrawer.tsx` mixes `React.useEffect(...)` (line 66) with destructured `useEffect(...)` (line 91) in the same file. `useEffect` is already imported at line 1.

## Background

Deferred from 2026-05-02 full audit (finding L16). Minor style inconsistency introduced when the speechError effect was added with the `React.` prefix while others use the destructured import.

## Acceptance Criteria

- [ ] All `useEffect` calls in `QuickLogDrawer.tsx` use the destructured `useEffect` form

## Implementation Notes

Change `React.useEffect(` at line 66 to `useEffect(`. One-liner.

## Dependencies

- None

## Risks

- None

## Updates

### 2026-05-02

- Initial creation (deferred from audit L16)
