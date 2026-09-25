---
title: "Coach stream ceiling test pins a hand-copied server SSE timeout — share SSE_TIMEOUT_MS so the ordering can't drift"
status: backlog
priority: low
created: 2026-09-25
updated: 2026-09-25
assignee:
labels: [deferred, testing]
github_issue:
---

# Coach stream ceiling test pins a hand-copied server SSE timeout — share SSE_TIMEOUT_MS so the ordering can't drift

## Summary

`client/hooks/__tests__/useCoachStream.test.ts` ("orders the ceilings") checks `STREAM_INACTIVITY_MS > 120_000`, where `120_000` is a hand-copied literal of the non-exported `SSE_TIMEOUT_MS` in `server/routes/chat.ts`. If the server value is raised, the test stays green while the real invariant breaks: the server cap must stay below the client inactivity window, which must stay below `XHR_TIMEOUT_MS`.

## Background

Advisory finding from the code-reviewer on PR #1068 (coach stream guaranteed termination). Deferred rather than fixed in that PR, because a push would have invalidated its review records (one review pass per PR).

## Acceptance Criteria

- [ ] `SSE_TIMEOUT_MS` lives in `shared/constants/` and is imported by `server/routes/chat.ts`
- [ ] The useCoachStream ceiling-ordering test imports the shared constant instead of a literal
- [ ] Optionally, `STREAM_INACTIVITY_MS` / `XHR_TIMEOUT_MS` are derived from it (e.g. `SSE_TIMEOUT_MS + 5_000`) with the ordering still asserted

## Implementation Notes

- Don't import `server/routes/chat.ts` into the jsdom client test: it pulls in Express and the DB at module load. That's why the constant has to move to `shared/`.
- Files: `shared/constants/` (new or existing file), `server/routes/chat.ts`, `client/hooks/useCoachStream.ts`, `client/hooks/__tests__/useCoachStream.test.ts`.
