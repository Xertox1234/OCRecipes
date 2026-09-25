---
title: "Coach Pro holds tool-status labels until the next content chunk, so a tool turn is silent on the wire"
status: done
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

- [x] A status event is written to the SSE stream when the tool calls are detected, before the tools run, not deferred to the next content chunk
- [x] Test: a Coach Pro turn with a tool round emits its status event before any content event
- [ ] Optional follow-up: lower `STREAM_INACTIVITY_MS` to match the new longest silent gap, and update its comment (not done — see Updates)

## Implementation Notes

- The `onToolCalls` callback passed to `generateCoachProResponse` pushes into `pendingStatusLabels`; the labels flush inside the chunk loop. A generator can't yield from a callback, so this needs the generator to yield a status marker, or the route needs a side channel for status writes.
- Files: `server/services/nutrition-coach.ts`, `server/services/coach-pro-chat.ts`, and `client/hooks/useCoachStream.ts` for the optional constant.

## Updates

### 2026-09-25 (implemented)

- `generateCoachProResponse` (`server/services/nutrition-coach.ts`) now yields a discriminated `CoachProChunk` union (`{ type: "content"; content }` | `{ type: "tool_calls"; toolNames }`) instead of a bare `string`, and yields the `tool_calls` chunk directly — immediately when a tool round is detected, before `Promise.all(...)` executes the tools — replacing the `onBeforeToolCalls` callback entirely. `handleCoachChat` (`server/services/coach-pro-chat.ts`) converts a `tool_calls` chunk into a `{ type: "status", label }` SSE event on receipt via the existing `getToolStatusLabel`, so the status write reaches the wire before the tool round runs instead of being deferred to the next content chunk.
- A generator-level test in `nutrition-coach.test.ts` proves the ordering directly: it holds `executeToolCall`'s promise open with a manually-resolved deferred, calls `gen.next()` once, and asserts the returned value is the `tool_calls` chunk while `executeToolCall` has NOT yet been called — this is the test that actually discriminates the fix from the old callback-based code (a companion assertion in `coach-pro-chat.test.ts`, using a synchronous mock, cannot distinguish old from new — both order status between the two content chunks once one arrives).
- Blast radius: `generateCoachProResponse` had exactly one production call site (`coach-pro-chat.ts`) and three test files mocking it directly — `nutrition-coach.test.ts`, `coach-pro-chat.test.ts`, and the route-level `server/routes/__tests__/chat.test.ts` (drives the real Express app via supertest) — all updated to the new chunk shape.
- **AC #3 (optional) — deliberately left `STREAM_INACTIVITY_MS` unchanged.** `server/services/coach-tools.ts`'s `executeToolCall` has no explicit per-call timeout (verified directly: `grep -ni "timeout|abortsignal|deadline|race("` over the whole 755-line file returns zero matches), so the silent-gap-during-tool-execution bound isn't a clean "one OpenAI call's cap + margin" calculation — tightening the client's inactivity window without a measured bound risks false-triggering on a slow tool. Updated the comment at `client/hooks/useCoachStream.ts:19-27` to state the new (accurate) reasoning instead of lowering the constant.
- Reviewed by `code-reviewer` + `server-reviewer` (both: no blocking findings). `server-reviewer` additionally traced the abort-signal interaction: the new `tool_calls` yield adds a real suspension point between tool-call detection and `Promise.all`, so an abort observed right after that yield now skips the tool round entirely (previously it always ran). Called out as a benign cost-saving side effect, not a defect — `conversation` is a local array discarded with the generator and `fullResponse` was already never persisted on the abort path.
- Full suite (`test:run`, `check:types`, `lint`) green at the implementation commit.
