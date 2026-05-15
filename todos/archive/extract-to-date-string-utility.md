---
title: "Extract toDateString utility"
status: in-progress
priority: low
created: 2026-04-07
updated: 2026-04-07
assignee:
labels: [code-quality, duplication]
---

# Extract toDateString utility

## Summary

`.toISOString().split("T")[0]` appears 16 times across 12 files. Extract to a shared utility for clarity.

## Acceptance Criteria

- [ ] `toDateString(date: Date): string` in `shared/lib/date.ts`
- [ ] All 16 occurrences replaced
- [ ] All tests pass

## Updates

### 2026-04-07

- Identified in full audit #6 (L10)
