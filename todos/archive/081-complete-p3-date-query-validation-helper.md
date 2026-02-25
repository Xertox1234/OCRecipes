---
title: "Create parseQueryDate helper for date query parameter validation"
status: pending
priority: p3
created: 2026-02-25
updated: 2026-02-25
assignee:
labels: [code-review, validation]
---

# Create parseQueryDate helper for date query parameter validation

## Summary

Several routes parse date query parameters with `new Date(req.query.from as string)` without validating the result. Invalid dates produce `Invalid Date` objects that get passed to storage functions.

## Background

Found by: security-sentinel (L4)

Affected files: medication.ts, weight.ts, exercises.ts, nutrition.ts.

## Acceptance Criteria

- [ ] `parseQueryDate(value: unknown): Date | undefined` helper created in `_helpers.ts`
- [ ] Returns `undefined` for invalid dates (NaN timestamp)
- [ ] Applied across all routes that parse date query params

## Updates

### 2026-02-25
- Created from code review (7-agent parallel review)
