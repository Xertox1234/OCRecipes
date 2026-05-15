---
title: "Add unit tests for handleCoachChat orchestration service"
status: in-progress
priority: high
created: 2026-04-12
updated: 2026-04-12
assignee:
labels: [testing, coach-pro]
---

# Add unit tests for handleCoachChat orchestration service

## Summary

`server/services/coach-pro-chat.ts` (`handleCoachChat`, 270 lines) is the main Coach Pro orchestration function extracted from `chat.ts` during the service extraction refactor. It has zero unit tests despite being the most critical new file in the extraction. A cache key regression was caught by code review — tests would have prevented this.

## Background

The coach-pro-test-coverage todo (completed 2026-04-12) added tests for the `coach-context` route and `generateCoachProResponse` service function, but the middle orchestration layer — `handleCoachChat` — was not covered. This function handles: context building, notebook injection, warm-up consumption, response caching, SSE event yielding, block parsing, message persistence, auto-titling, and notebook extraction. A cache key bug (userId omitted from hash) was found in code review and fixed in `aa6dcc2`.

## Acceptance Criteria

- [ ] `server/services/__tests__/coach-pro-chat.test.ts` created
- [ ] Tests cover cache key includes userId (regression test for the bug fixed in `aa6dcc2`)
- [ ] Tests cover warm-up consumption path (warmUpId provided vs not)
- [ ] Tests cover Coach Pro vs standard coach branching (isCoachPro flag)
- [ ] Tests cover notebook injection into context (entries present vs empty)
- [ ] Tests cover SSE event yielding (content events, block events)
- [ ] Tests cover auto-titling on first exchange (fire-and-forget)
- [ ] Tests cover notebook extraction after response
- [ ] All tests pass

## Implementation Notes

- Mock `storage`, `generateCoachProResponse`, `generateCoachResponse`, `consumeWarmUp`, and `extractNotebookEntries`
- The function is an `AsyncGenerator` yielding `{ type: "content" | "blocks", ... }` events — use `for await` to collect
- Follow patterns in `server/routes/__tests__/chat.test.ts` and `server/services/__tests__/nutrition-coach.test.ts`
- The cache key test should verify the hash includes userId: mock `createHash` or check `storage.getCoachCachedResponse` is called with a hash derived from both userId and content

## Dependencies

- None — all dependent modules already exist

## Risks

- The function has many side effects (storage writes, fire-and-forget calls) that need careful mock setup
- The AsyncGenerator pattern requires testing the yield sequence, not just the final result

## Updates

### 2026-04-12

- Created from code review finding: handleCoachChat has zero test coverage
- Cache key regression (fixed in aa6dcc2) would have been caught by these tests
