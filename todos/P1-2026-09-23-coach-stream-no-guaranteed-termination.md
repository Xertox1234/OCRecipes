---
title: "Coach stream can hang forever — useCoachStream has no XHR timeout and no handler for a clean close without a done event"
status: backlog
priority: high
created: 2026-09-23
updated: 2026-09-23
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

- [ ] `xhr.timeout` + `xhr.ontimeout` set, with a ceiling above the longest legitimate coach stream
- [ ] A JS inactivity timer, reset on every progress chunk, aborts a stalled stream and surfaces the existing streaming-error UI
- [ ] `readyState === 4` with a 2xx status and no `done` clears streaming state and finalizes (or errors) the message
- [ ] Tests (fake XHR): timeout event, inactivity stall, and clean-close-without-done each end with `isStreaming === false`
- [ ] Failing test written first (TDD), then the fix; the test fails on current `main` and passes after.

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
