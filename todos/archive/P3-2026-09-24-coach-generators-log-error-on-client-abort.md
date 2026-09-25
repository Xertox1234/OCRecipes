---
title: "Coach generators log ERROR on every client disconnect now that the abort fires"
status: done
priority: low
created: 2026-09-24
updated: 2026-09-25
assignee:
labels: [deferred, observability]
github_issue:
---

# Coach generators log ERROR on every client disconnect now that the abort fires

## Summary

Since #1060, a client disconnect really aborts the OpenAI stream. `generateCoachResponse` and `generateCoachProResponse` catch the resulting abort error themselves and log it at ERROR ("coach streaming error" / "coach pro streaming error"), so every routine Ask Coach dismiss produces an error line.

## Background

Deferred from the #1060 server review (MEDIUM). The route's own debug-level downgrade (`server/routes/chat.ts`, the `catch` checking `clientDisconnected`) is rarely reached, because the generators swallow the abort and `return` instead of rethrowing. `server/services/nutrition-coach.ts` was outside the H6 scope.

## Acceptance Criteria

- [x] An abort caused by `abortSignal` is logged below ERROR (or not at all) in both generators; real stream failures still log at ERROR
- [x] A test pins both sides: aborted signal → no error log; a non-abort stream error → error log

## Implementation Notes

- `server/services/nutrition-coach.ts`: in the stream `catch` blocks of `generateCoachResponse` and `generateCoachProResponse`, branch on `abortSignal?.aborted`.
- The "Sorry, the response was interrupted" yield after an abort is never delivered (the service and route both break on `isAborted()`), so it can be skipped as well.

## Updates

### 2026-09-25 (implemented)

- **Scope widened from Implementation Notes to satisfy the AC's literal wording** ("in both generators", not "in the stream catch blocks"): all four `catch` blocks in `server/services/nutrition-coach.ts` — the initial `openai.chat.completions.create` catch AND the mid-stream catch, in both `generateCoachResponse` and `generateCoachProResponse` — now branch on `abortSignal?.aborted`. On abort: `log.debug(...)` and an early `return` (no "Sorry, ..." yield — dead code on this path in every caller). On a real failure: unchanged `log.error(...)` + interrupted-message yield.
- **Consequence caught by the advisor pre-check (Step 3.5, YELLOW) and addressed inline, not deferred**: the SSE timeout and the byte-limit guard in `server/routes/chat.ts` share the same `AbortController`/`AbortSignal` as a client disconnect, so this change also silently downgraded a genuine hang's only log line to debug. Added one `logger.warn({ conversationId: id }, "chat SSE stream timed out")` in the `sseTimeout` handler so a hang stays visible at warn even though the generator's own log no longer fires at error for it. No test covers this new line (a real 2-minute timer, no fake-timer harness exists for it in `chat.test.ts` either before or after this change) — server-reviewer flagged this gap as non-blocking.
- Tests: `server/services/__tests__/nutrition-coach.test.ts` — switched the logger mock from a per-call factory to a `vi.hoisted` singleton (`mockLog`) so `.error`/`.debug` calls are assertable (the module captures `createServiceLogger()`'s return once, at import time). Added an abort-side test and a same-block non-abort control for each of the four catch sites (8 tests total touched: 4 new, 4 existing gained a control assertion).
- Review: `code-reviewer` + `server-reviewer` (server-reviewer: clean, no blocking findings, confirmed no path lets a real failure coincide with `abortSignal.aborted === true`, confirmed the skipped yield was already unreachable in every consumer).
- `ADVISOR: yellow` — the shared-AbortSignal consequence above; resolved inline rather than left as a residual.
- Full suite (`test:run`, `check:types`, `lint`) green at the implementation commit.

### 2026-09-25 (review repair)

- Independent review: every "real failure still logs at ERROR" control called the generator with no signal, while production always passes a live one, so a regression to a bare `if (abortSignal)` check would pass while hiding every real OpenAI failure. Added a live, never-aborted-signal control per generator; verified both fail under that regression. The byte-limit guard never reaches the generators' catch blocks (it closes them via `return()`) and logged nothing server-side; both trip sites in `chat.ts` now `logger.warn` with the byte count, and the four comments that listed it as a catch-path cause are corrected. Test-count correction for the note above: 5 new tests and 3 existing tests gained a control (not 4/4).
