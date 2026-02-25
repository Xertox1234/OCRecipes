---
title: "Inconsistent API error response format"
status: backlog
priority: high
created: 2026-02-24
updated: 2026-02-24
assignee:
labels: [architecture, code-review, api]
---

# Inconsistent API Error Response Format

## Summary

Error responses use at least 4 different shapes: `{error}`, `{error, code}`, `{error, message, ...metadata}`, and `{message}` from the global handler. The `sendError` utility exists but is only used in 1 of 23 route files.

## Background

The recipes route uses `{error: "ERROR_CODE", message: "human text"}` while _helpers uses `{error: "human text", code: "ERROR_CODE"}`. The global error handler returns `{message}` instead of `{error}`. This makes client-side error handling fragile.

## Acceptance Criteria

- [ ] Standardized error shape: `{ error: string, code?: string }`
- [ ] Global error handler uses same shape
- [ ] `sendError` utility adopted in all 23 route files or an asyncHandler wrapper created
- [ ] 60+ inline catch blocks use consistent pattern

## Updates

### 2026-02-24
- Found by architecture-strategist and pattern-recognition agents
