---
title: "Add rate limiter to suggestions endpoint (OpenAI call)"
status: pending
priority: p1
created: 2026-02-25
updated: 2026-02-25
assignee:
labels: [code-review, security, performance, rate-limiting]
---

# Add rate limiter to suggestions endpoint (OpenAI call)

## Summary

`POST /api/items/:id/suggestions` in `server/routes/suggestions.ts` calls OpenAI but has no rate limiter, exposing the app to cost abuse.

## Background

Found by: pattern-recognition-specialist (R1)

The instructions sub-endpoint at `POST /api/items/:id/instructions/:index` has `instructionsRateLimit`, but the main suggestions endpoint that triggers OpenAI API calls has none. This is the most significant rate limiting gap in the codebase.

**File:** `server/routes/suggestions.ts`

## Acceptance Criteria

- [ ] `POST /api/items/:id/suggestions` has a rate limiter applied
- [ ] Use `instructionsRateLimit` or create a dedicated `suggestionsRateLimit` via `createRateLimiter`

## Implementation Notes

Add the existing `instructionsRateLimit` (20/min) to the suggestions route, or create a tighter `suggestionsRateLimit` (e.g., 10/min) since it triggers OpenAI calls.

## Updates

### 2026-02-25
- Created from code review (7-agent parallel review)
