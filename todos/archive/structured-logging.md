---
title: "Replace console logging with structured logger"
status: done
priority: high
created: 2026-03-27
updated: 2026-03-29
assignee:
labels: [observability, server, launch-follow-up]
---

# Replace console logging with structured logger

## Summary

Replace 266 `console.warn`/`console.error` calls across 56 server files with pino (JSON structured logging) and add request ID propagation for production debugging.

## Background

The launch audit identified this as the highest-impact remaining item for production operations. Currently:

- All logging uses `console.warn` (aliased as `log` in index.ts) because ESLint only allows `warn` and `error`
- Response bodies are truncated to 79 characters
- No request IDs — impossible to correlate a user's report with server logs
- No structured fields — log aggregation services (Datadog, CloudWatch) can't parse or filter
- OpenAI API calls costing real money have no duration logging at the route level

## Acceptance Criteria

- [ ] pino installed and configured as the server logger
- [ ] JSON output in production, pretty-print in development
- [ ] Request ID generated per-request (via middleware), propagated to all log calls
- [ ] All `console.warn`/`console.error` replaced with `logger.info`/`logger.warn`/`logger.error`
- [ ] Request logger outputs method, path, status, duration, requestId as structured fields
- [ ] Response body logging removed (security concern, replaced by status code + error code)
- [ ] ESLint `no-console` rule updated to disallow all console methods (enforces logger usage)
- [ ] All 3133+ tests still pass

## Implementation Notes

- Use `pino` (not winston) — it's the fastest Node.js logger and Express-native
- Add `pino-http` middleware for automatic request/response logging
- Create `server/lib/logger.ts` that exports the configured logger
- Request ID: generate UUID in middleware, attach to `req.id`, include in all log calls
- The `SENSITIVE_PATHS` exclusion from index.ts should carry over (don't log auth response bodies)
- `fireAndForget` helper already labels its operations — these labels should become structured fields

## Dependencies

- None — pure refactor, no feature changes

## Risks

- Touching 56 files is a large diff — do in a dedicated branch
- Some tests mock `console.error` to verify error logging — these need to mock the logger instead
- pino's default serializers may log more than expected (e.g., full request headers) — configure serializers carefully

## Updates

### 2026-03-27

- Identified during launch readiness audit (H1)
- 266 console calls across 56 server files counted
