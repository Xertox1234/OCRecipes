---
title: "Coach Pro holds tool-status labels until the next content chunk, so a tool turn is silent on the wire"
status: in-progress
priority: low
created: 2026-09-25
updated: 2026-09-25
assignee:
labels: [deferred, api, reliability]
github_issue:
---

# Coach Pro holds tool-status labels until the next content chunk, so a tool turn is silent on the wire

## Summary

`server/services/coach-pro-chat.ts` collects tool-status labels in `pendingStatusLabels` (its Coach Pro branch) and yields them only inside the `for await` over `generateCoachProResponse` (`server/services/nutrition-coach.ts`), when the next content chunk arrives. During tool rounds the SSE stream sends nothing. Because of that, the client can't tell a working multi-round turn from a stalled one, and the user sees "Thinking…" instead of "Checking your pantry…" while the tools run.

## Background

Found while fixing the P1 coach-stream termination todo (archived `todos/archive/P1-2026-09-23-coach-stream-no-guaranteed-termination.md`). The client's inactivity window (`STREAM_INACTIVITY_MS` in `client/hooks/useCoachStream.ts`) had to be set above the server's whole 120s SSE budget for exactly this reason. With a status event per tool round, it could drop to about one OpenAI call's cap plus tool time, and a dead connection would be noticed in well under a minute instead of about 2 minutes.

## Acceptance Criteria

- [ ] A status event is written to the SSE stream when the tool calls are detected, before the tools run, not deferred to the next content chunk
- [ ] Test: a Coach Pro turn with a tool round emits its status event before any content event
- [ ] Optional follow-up: lower `STREAM_INACTIVITY_MS` to match the new longest silent gap, and update its comment

## Implementation Notes

- The `onToolCalls` callback passed to `generateCoachProResponse` pushes into `pendingStatusLabels`; the labels flush inside the chunk loop. A generator can't yield from a callback, so this needs the generator to yield a status marker, or the route needs a side channel for status writes.
- Files: `server/services/nutrition-coach.ts`, `server/services/coach-pro-chat.ts`, and `client/hooks/useCoachStream.ts` for the optional constant.
