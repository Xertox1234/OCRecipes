---
title: "Move the chat turn engine (runTurn/SseSink) from routes/chat-stream.ts to a service; one SSE framing owner"
status: done
priority: low
created: 2026-11-06
updated: 2026-11-06
assignee:
labels: [deferred, architecture]
github_issue:
---

# Move the chat turn engine out of routes/

## Summary

`server/routes/chat-stream.ts` (636 lines, no `register`) holds the coach/recipe turn engine: `runTurn`, `SseSink`, `openSse`, `CONVERSATION_CONFIG` and about 15 `storage.*` calls. `chat-admit.ts:34` also writes an SSE frame by hand, outside `SseSink`. This is finding L2 from the 2026-11-06 architecture audit.

## Background

The 2026-10-26 chat decomposition todo allowed the helpers to go in either `routes/` or a service, and the split chose `routes/`. The engine can only be tested through an Express `Response`. Two places own SSE framing, so a wire-format change (event shape, ping, timeout) has to be made twice. Deferred as Low: there's no defect, only structure.

## Acceptance Criteria

- [x] Turn orchestration (`runTurn` + storage persistence) lives in `server/services/` with unit tests that don't need Express
- [x] `chat-admit.ts` writes its `done` frame through `SseSink` (or a shared frame helper); `res.write(` with SSE framing appears in one module only
- [x] `chat.ts`, `chat-admit.ts` and their tests pass unchanged in behaviour

## Implementation Notes

- Files: `server/routes/chat-stream.ts`, `server/routes/chat-admit.ts`, `server/routes/chat.ts`, `server/routes/__tests__/chat*.test.ts`.
- Keep the SSE byte cap and the H6 refund-vs-persist settle exactly as they are. Move first, then change.
