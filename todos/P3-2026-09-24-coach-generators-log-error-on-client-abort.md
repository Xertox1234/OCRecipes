---
title: "Coach generators log ERROR on every client disconnect now that the abort fires"
status: backlog
priority: low
created: 2026-09-24
updated: 2026-09-24
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

- [ ] An abort caused by `abortSignal` is logged below ERROR (or not at all) in both generators; real stream failures still log at ERROR
- [ ] A test pins both sides: aborted signal → no error log; a non-abort stream error → error log

## Implementation Notes

- `server/services/nutrition-coach.ts`: in the stream `catch` blocks of `generateCoachResponse` and `generateCoachProResponse`, branch on `abortSignal?.aborted`.
- The "Sorry, the response was interrupted" yield after an abort is never delivered (the service and route both break on `isAborted()`), so it can be skipped as well.
