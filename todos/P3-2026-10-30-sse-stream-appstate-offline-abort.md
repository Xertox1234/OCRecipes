---
title: "Fail coach/chat SSE streams fast on offline or a dead resumed socket"
status: backlog
priority: low
created: 2026-10-30
updated: 2026-10-30
assignee:
labels: [deferred, reliability, client]
github_issue:
---

# Fail coach/chat SSE streams fast on offline or a dead resumed socket

## Summary

The raw-XHR SSE streams (`client/hooks/useCoachStream.ts`, `client/hooks/useChat.ts`)
are not aborted when the device goes offline or the app returns from background
with a half-open socket, so "Thinking…" can hang for up to `STREAM_INACTIVITY_MS`
(about 125 s) in the coach, and up to the 150 s XHR cap in recipe chat, which
has no inactivity watchdog.

## Background

Reliability audit 2026-10-30, finding R22 (Low). The session-expiry half of
R22 (a 401 on a stream now goes through `notifyIfStreamSessionExpired`) shipped
in the iap-auth PR. The AppState / online-transition half was deferred: it is
UX latency, not data loss, and it needs a decision on what to do with a stream
that resumes mid-reply (the server finishes and saves the reply after a
disconnect, so aborting must refetch rather than show an error).

## Acceptance Criteria

- [ ] An offline transition (`onlineManager`) during a stream fails it promptly with the existing network-error copy.
- [ ] A background → active resume with no bytes received since resume fails or restarts the stream within a few seconds instead of waiting for the inactivity cap.
- [ ] `useChat`'s stream gets an inactivity watchdog (`inactivityMs`) like the coach stream.
- [ ] An aborted stream invalidates the conversation's messages query so the server-saved reply appears.
- [ ] Tests cover offline, resume-with-dead-socket, and resume-with-live-socket.

## Implementation Notes

- `client/lib/sse-xhr.ts` already supports `signal` and `inactivityMs`.
- `client/hooks/useCoachStream.ts` (`streamSse` call, `onClose`), `client/hooks/useChat.ts` (`streamSse` call around the `CHAT_XHR_TIMEOUT_MS` options).
- Follow the existing finish-and-save invalidation pattern in `useChat.ts` (`refetchType: "none"`).

## Scope Contract

- **Mechanisms to use:** existing `streamSse` `signal`/`inactivityMs`, React Native `AppState`, TanStack `onlineManager`.
- **Files in scope:** `client/hooks/useCoachStream.ts`, `client/hooks/useChat.ts`, `client/lib/sse-xhr.ts`, their `__tests__/`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Risks

- Aborting a stream that would have recovered; resume heuristics must not cut a slow but live reply.

## Updates

### 2026-10-30

- Initial creation (deferred remainder of reliability audit R22).
