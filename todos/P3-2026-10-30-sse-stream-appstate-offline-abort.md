---
title: "Fail coach/chat SSE streams fast on offline or a dead resumed socket"
status: backlog
priority: low
created: 2026-10-30
updated: 2026-11-04
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
- [ ] The server stream sends an SSE comment keep-alive (`: ping\n\n`) every 15 s while a reply is in flight; the interval is cleared wherever the stream ends (done, error, client disconnect, SSE timeout).
- [ ] A background → active resume with no bytes (data or ping) received within 20 s of resume aborts the stream quietly — no error copy — and refetches the conversation's messages; a ping or data byte inside the 20 s keeps the stream running.
- [ ] `useChat`'s stream gets an inactivity watchdog (`inactivityMs`) like the coach stream.
- [ ] An aborted stream invalidates the conversation's messages query so the server-saved reply appears, re-checking (every 5 s, max 60 s) when the reply was not saved yet.
- [ ] Tests cover offline, resume-with-dead-socket, resume-with-live-socket (a ping inside 20 s keeps it), and the server ping interval starting and being cleared.

## Implementation Notes

- `client/lib/sse-xhr.ts` already supports `signal` and `inactivityMs`. Its parser skips any line not starting with `data: ` (~line 126), so `: ping` lines are ignored as events; verify the inactivity watchdog re-arms on ANY received bytes (`xhr.onprogress` → `deliver`), not only on parsed `data:` events, or the ping will not keep a live stream alive.
- Server: add the ping in `SseSink` in `server/routes/chat-stream.ts` (the one SSE writer for both coach and recipe chat), next to its existing `SSE_TIMEOUT_MS` timer; write only while `!res.writableEnded`.
- Offline (`onlineManager` goes offline) → abort and show the existing network-error copy. Resume with a dead socket → abort quietly + refetch (the server finishes and saves the reply after a disconnect), not an error.
- 🛑 Owner ruling 2026-09-29: leaving a Coach chat mid-reply keeps the reply running. The new abort triggers are AppState-resume and offline ONLY — do NOT add an unmount abort to `useSendMessage`. The toast + red-dot path (`client/hooks/useCoachUnreadReplies.ts`) is for replies that finish after the user LEFT; leave it unchanged.
- The server may still be generating when a quiet abort fires, so one refetch can come back without the reply. After a quiet abort, refetch the messages again every 5 s until the assistant reply for that turn appears, for at most 60 s, and only while that conversation is on screen.
- `client/hooks/useCoachStream.ts` (`streamSse` call, `onClose`), `client/hooks/useChat.ts` (`streamSse` call around the `CHAT_XHR_TIMEOUT_MS` options).
- Follow the existing finish-and-save invalidation pattern in `useChat.ts` (`refetchType: "none"`).

## Scope Contract

- **Mechanisms to use:** existing `streamSse` `signal`/`inactivityMs`, React Native `AppState`, TanStack `onlineManager`, an SSE comment keep-alive in the existing `SseSink`.
- **Files in scope:** `client/hooks/useCoachStream.ts`, `client/hooks/useChat.ts`, `client/lib/sse-xhr.ts`, `server/routes/chat-stream.ts`, their `__tests__/`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Risks

- Aborting a stream that would have recovered; resume heuristics must not cut a slow but live reply.

## Updates

### 2026-10-30

- Initial creation (deferred remainder of reliability audit R22).

### 2026-11-04

- Owner ruling: add a server keep-alive. The server sends `: ping` every 15 s during a reply; after a background → active resume, 20 s with no bytes means a dead socket → abort quietly and refetch messages. Offline still fails fast with the network-error copy. Scope widened to `server/routes/chat-stream.ts`. No open questions; ready for automation (the `server/routes/` change means the PR is held for review, not auto-merged).
