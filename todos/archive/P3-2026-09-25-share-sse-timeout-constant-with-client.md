---
title: "Coach stream ceiling test pins a hand-copied server SSE timeout — share SSE_TIMEOUT_MS so the ordering can't drift"
status: done
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

- [x] `SSE_TIMEOUT_MS` lives in `shared/constants/` and is imported by `server/routes/chat.ts`
- [x] The useCoachStream ceiling-ordering test imports the shared constant instead of a literal
- [x] Optionally, `STREAM_INACTIVITY_MS` / `XHR_TIMEOUT_MS` are derived from it (e.g. `SSE_TIMEOUT_MS + 5_000`) with the ordering still asserted

## Implementation Notes

- Don't import `server/routes/chat.ts` into the jsdom client test: it pulls in Express and the DB at module load. That's why the constant has to move to `shared/`.
- Files: `shared/constants/` (new or existing file), `server/routes/chat.ts`, `client/hooks/useCoachStream.ts`, `client/hooks/__tests__/useCoachStream.test.ts`.

## Updates

### 2026-09-25

- Implemented: created `shared/constants/sse.ts` exporting `SSE_TIMEOUT_MS = 120_000`, imported by `server/routes/chat.ts` (replacing the local literal) and by `client/hooks/useCoachStream.ts`, which now derives `STREAM_INACTIVITY_MS = SSE_TIMEOUT_MS + 5_000` and `XHR_TIMEOUT_MS = STREAM_INACTIVITY_MS + 25_000` (same 120s/125s/150s values as before). The "orders the ceilings" test imports `SSE_TIMEOUT_MS` from `@shared/constants/sse` instead of the hand-copied `120_000` literal. Reviewed clean by `code-reviewer` + `server-reviewer` — no findings.
