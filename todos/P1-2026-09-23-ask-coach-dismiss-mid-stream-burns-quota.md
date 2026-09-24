---
title: "Closing Ask Coach mid-answer spends a daily message, saves no reply, and leaves an unretryable stub conversation — needs a product decision"
status: backlog
priority: high
created: 2026-09-23
updated: 2026-09-23
assignee:
labels: [deferred, audit, reliability, product-decision]
github_issue:
human_led: true
---

# Closing Ask Coach mid-answer spends a daily message, saves no reply, and leaves an unretryable stub conversation — needs a product decision

## Summary

Closing the "Ask Coach" overlay while the reply is streaming aborts the request; the server skips persisting the assistant reply but has already created and quota-counted the user's message, leaving a one-message conversation that cannot be retried.

## Background

Found by the 2026-09-23 front-end audit (read-only, 6 lenses + Context7 research). Finding ID(s): **H6** in `docs/audits/2026-09-23-frontend.md` (local-only, gitignored). Each claim below was re-read against the code at HEAD `3df8b4b3`; line numbers may drift.

- Client: `CoachOverlayContent.tsx:163-173` cleans up with `abortStream()`; `useCoachStream.ts:147-167` aborts the XHR without salvaging accumulated text. Each Ask Coach open creates a fresh conversation (:150-151).
- Server: `server/routes/chat.ts:338` `createChatMessageWithLimitCheck` runs BEFORE the SSE headers (:360-363) — the user message is persisted and counted first. On disconnect, `aborted = true` and `if (!aborted && …)` (:479) skips saving the reply; `server/services/coach-pro-chat.ts` does the same via `isAborted()`.
- `CoachChat.handleRetry` (:425-428) requires the last message to be role `assistant`, so a user-only turn can never be regenerated.
- The same abort-on-unmount exists in `CoachChat.tsx:829-833` (weaker reachability: CoachPro tab stays mounted).

## Acceptance Criteria

- [ ] A product decision is recorded in this todo: (a) finish generation server-side and persist even after client disconnect, (b) refund the quota for an aborted turn, (c) allow retrying a trailing user-only turn, or a combination
- [ ] The chosen behavior is implemented with tests on both client and server sides
- [ ] No quota is consumed without either a persisted reply or a retry path
- [ ] Failing test written first (TDD), then the fix; the test fails on current `main` and passes after.

## Implementation Notes

Option (a) is usually the most user-friendly (the answer appears in history next time) but costs tokens for abandoned turns. Option (c) is the smallest client-only change. Decide before implementing.

## Scope Contract

- **Mechanisms to use:** existing project patterns cited above — nothing new beyond what the acceptance criteria name.
- **Files in scope:**
  - `client/components/CoachOverlayContent.tsx`
  - `client/hooks/useCoachStream.ts`
  - `client/components/coach/CoachChat.tsx`
  - `server/routes/chat.ts`
  - `server/services/coach-pro-chat.ts`
  - `server/storage/chat.ts`
  - matching `__tests__/`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- Touches quota accounting — treat as business-logic-sensitive and review with server-reviewer.
- Server-side completion after disconnect must not write to a response that has ended.

## Updates

### 2026-09-23

- Initial creation from the 2026-09-23 front-end audit (H6).
