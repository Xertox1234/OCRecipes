---
title: "Extract parsePositiveIntParam helper (35+ duplicates)"
status: backlog
priority: low
created: 2026-02-24
updated: 2026-02-24
assignee:
labels: [refactor, code-review, dry]
---

# Extract ID Parsing Helper

## Summary

35+ route handlers duplicate `parseInt(req.params.id, 10)` + `isNaN` check, with two inconsistent variants (some check `<= 0`, others don't).

## Acceptance Criteria

- [ ] `parsePositiveIntParam(value: string): number | null` helper in _helpers.ts
- [ ] All 35+ occurrences use the helper
- [ ] Consistent validation (always checks for positive)

## Updates

### 2026-02-24
- Found by pattern-recognition agent
