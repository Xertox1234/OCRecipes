---
title: "Coach stream can hang forever — useCoachStream has no XHR timeout and no handler for a clean close without a done event"
status: done
priority: high
created: 2026-09-23
updated: 2026-09-25
assignee:
labels: [deferred, audit, reliability]
github_issue:
---

# Coach stream can hang forever — useCoachStream has no XHR timeout and no handler for a clean close without a done event

## Summary

`useCoachStream` only clears `isStreaming` on a `data.done` SSE event, an error, or status ≥400. A half-open connection or a clean 200 close without `done` leaves `isStreaming` true, and `CoachChat.handleSend` refuses to send until the app restarts.

## Background

Found by the 2026-09-23 front-end audit (read-only, 6 lenses + Context7 research). Finding ID(s): **H5** in `docs/audits/2026-09-23-frontend.md` (local-only, gitignored). Each claim below was re-read against the code at HEAD `3df8b4b3`; line numbers may drift.

- `client/hooks/useCoachStream.ts`: zero `timeout`/`ontimeout` references; only `readyState === 4 && status >= 400` is handled (:270); the 50ms drain (:111-145) only stops on `isDoneRef`.
- Sibling `client/hooks/useChat.ts:245,282` sets `xhr.timeout = 120_000` and `ontimeout`.
- Research (installed RN 0.81.5 source): Android OkHttp has no timeouts by default (`OkHttpClientProvider.kt:49-54`), and `xhr.timeout` maps to OkHttp `callTimeout` — a TOTAL-call cap, not idle. Even when iOS times out natively, RN dispatches a `timeout` event (`XMLHttpRequest.js:436-437,696-699`), not `error`, and this hook listens only to `onerror`.
- Research also surfaced (b): a clean close (proxy cut, server crash after headers) at `readyState` 4 / 200 without `done` has no handler.
- `CoachChat.handleSend` gate: `if (!content || isStreaming) return;` (:387).

## Acceptance Criteria

- [x] `xhr.timeout` + `xhr.ontimeout` set, with a ceiling above the longest legitimate coach stream
- [x] A JS inactivity timer, reset on every progress chunk, aborts a stalled stream and surfaces the existing streaming-error UI
- [x] `readyState === 4` with a 2xx status and no `done` clears streaming state and finalizes (or errors) the message
- [x] Tests (fake XHR): timeout event, inactivity stall, and clean-close-without-done each end with `isStreaming === false`
- [x] Failing test written first (TDD), then the fix; the test fails on current `main` and passes after.

## Implementation Notes

Reuse the error surface already used for `data.error` events (:222-228). Keep partial content handling consistent with the existing error path.

## Scope Contract

- **Mechanisms to use:** existing project patterns cited above — nothing new beyond what the acceptance criteria name.
- **Files in scope:**
  - `client/hooks/useCoachStream.ts`
  - `client/hooks/__tests__/useCoachStream*.test.ts`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- Picking the inactivity window: too short aborts slow tool-calling turns (Coach Pro tool calls can pause output). Measure server status-event cadence first.

## Updates

### 2026-09-23

- Initial creation from the 2026-09-23 front-end audit (H5).

### 2026-09-25

- Fixed in `client/hooks/useCoachStream.ts`. Every terminal path (`data.error`, status >= 400, `onerror`, `ontimeout`, clean close, inactivity) goes through one idempotent `fail`, guarded by a per-stream `settled` flag. `done` also settles.
- Ceilings: server `SSE_TIMEOUT_MS` 120s < `STREAM_INACTIVITY_MS` 125s < `XHR_TIMEOUT_MS` 150s. The inactivity window can't be shorter: Coach Pro flushes tool-status labels only with the next content chunk, so a multi-round tool turn is silent on the wire for up to the whole server budget (5 tool calls, each a 30s-capped OpenAI call). Above 120s, the client timer fires only on a dead connection, because a live one gets the server's own graceful `Response timeout` first.
- A clean close without `done` is reported as an error ("Response interrupted"), even with partial content. It doesn't finalize a partial: that reply was never finished or saved server-side, so an `onDone` would show text that vanishes on refetch. This matches the Implementation Note (consistent with the error path).
- Detected via `xhr.onload`, not `readyState 4`. RN (`XMLHttpRequest.js` `setReadyState`) dispatches readystatechange at DONE before `timeout`/`error`/`abort`, with status still 200 on a native failure, so a readyState-4 check would mistake a timeout for a clean close.
