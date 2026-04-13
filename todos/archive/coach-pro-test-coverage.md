---
title: "Coach Pro test coverage — route + service unit tests"
status: backlog
priority: high
created: 2026-04-12
updated: 2026-04-12
assignee:
labels: [testing, coach-pro, audit-2026-04-12]
---

# Coach Pro Test Coverage

## Summary

Add missing test files for Coach Pro routes and service functions. Fixes H3 and H4 from the 2026-04-12 audit.

## Background

`coach-context.ts` is the only route module without a test file. `generateCoachProResponse` (the tool-calling loop, 165 LOC) is the most complex new logic in Coach Pro but has no unit tests — only tested indirectly via mocked chat route tests.

## Acceptance Criteria

- [ ] **H3**: `server/routes/__tests__/coach-context.test.ts` created with tests for:
  - GET `/api/coach/context` — returns context with notebook, commitments, suggestions
  - GET `/api/coach/context` — requires premium feature check
  - POST `/api/coach/warm-up` — validates body, verifies conversation ownership
  - POST `/api/coach/warm-up` — rate limited
- [ ] **H4**: `server/services/__tests__/nutrition-coach.test.ts` extended with tests for:
  - `generateCoachProResponse` tool-calling loop
  - `MAX_TOOL_CALLS_PER_RESPONSE` enforcement
  - Tool call error recovery
  - Multi-round conversation building
- [ ] All new tests pass

## Implementation Notes

- Follow existing patterns in `server/routes/__tests__/chat.test.ts` for route test structure.
- Mock `storage` and `generateCoachProResponse` at route level; mock OpenAI at service level.

## Updates

### 2026-04-12
- Created from audit findings H3, H4
