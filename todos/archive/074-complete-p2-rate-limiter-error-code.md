---
title: "Add RATE_LIMITED error code to rate limiter responses"
status: pending
priority: p2
created: 2026-02-25
updated: 2026-02-25
assignee:
labels: [code-review, agent-native, error-handling]
---

# Add RATE_LIMITED error code to rate limiter responses

## Summary

Rate limiter 429 responses lack a machine-readable `code` field, making it impossible for API consumers to distinguish infrastructure rate limiting from business-logic 429s like `DAILY_LIMIT_REACHED`.

## Background

Found by: agent-native-reviewer (C2)

**File:** `server/routes/_helpers.ts`, line 106

Current: `message: { error: options.message }` — no code field.

## Acceptance Criteria

- [ ] Rate limiter message includes `code: "RATE_LIMITED"`
- [ ] API consumers can distinguish rate limiting from business-logic 429s

## Implementation Notes

One-line change:
```typescript
message: { error: options.message, code: "RATE_LIMITED" },
```

## Updates

### 2026-02-25
- Created from code review (7-agent parallel review)
