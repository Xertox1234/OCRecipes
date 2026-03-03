---
title: "Migrate auth middleware to use sendError() for consistency"
status: pending
priority: p2
created: 2026-02-25
updated: 2026-02-25
assignee:
labels: [code-review, consistency, error-handling, auth]
---

# Migrate auth middleware to use sendError() for consistency

## Summary

`server/middleware/auth.ts` has 3 remaining instances of raw `res.status(401).json(...)` instead of using `sendError()`. This is the only file producing error responses outside the standard utility.

## Background

Found by: architecture-strategist, agent-native-reviewer (W2)

Lines 59, 71, 81, 90, 97, 108, 111 all use raw `.json()`. While they produce the same `{ error, code }` shape, using a different code path means future changes to the error format need to be applied in two places.

**File:** `server/middleware/auth.ts`

## Acceptance Criteria

- [ ] All error responses in auth.ts use `sendError()`
- [ ] Error codes preserved (NO_TOKEN, TOKEN_EXPIRED, TOKEN_INVALID, TOKEN_REVOKED)

## Updates

### 2026-02-25
- Created from code review (7-agent parallel review)
