---
title: "Closing Ask Coach mid-answer spends a daily message, saves no reply, and leaves an unretryable stub conversation — needs a product decision"
status: in-progress
priority: high
created: 2026-09-23
updated: 2026-09-24
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

- [x] A product decision is recorded in this todo: (a) finish generation server-side and persist even after client disconnect, (b) refund the quota for an aborted turn, (c) allow retrying a trailing user-only turn, or a combination
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

### 2026-09-24

- **Product decision (user): Hybrid.** Client disconnect before any content is streamed → refund (delete the user row; quota is `count(*)` of today's user rows). Disconnect after content → persist the partial reply (so the paid quota bought something, and the existing Retry works). A pure refund was rejected: a client could read the whole answer and abort just before `done`.
- **Premise correction (measured):** the audit's "server skips persisting the reply" never happened at runtime. `req.on("close")` never fires on Node 24 once `express.json()` has consumed the body, so the M8 abort was dead code. On disconnect the server finished generating and saved the full reply, spending full tokens. Fixed by listening on `res` `close` + `!res.writableFinished`.
- Abort is wired for the coach path only; recipe/remix keeps finish-and-save (follow-up todo `P2-2026-09-24-recipe-chat-disconnect-policy.md`).
- Duplicate guard: the route mints a per-turn `turnKey` when the client sends none, so the settle can tell via `getChatMessageByTurnKey` whether the service's own write already landed.
- Accepted residual: a refund leaves a zero-message conversation in history (already true when the overlay closes before the POST fires).
- **Accepted residual (user, 2026-09-24), from the #1060 server review:** a Coach Pro turn that disconnects during a tool-call round (only `status` events, no content yet) is refunded, even though an OpenAI round and tool run already happened. A client could repeat that to spend tokens without using quota, limited by `chatRateLimit`. Accepted because any refund-before-first-token already spends prompt tokens, and the client gets no answer; tool rounds only widen that bounded cost.
- #1060 review: the settle step vets a partial with `containsUnsafeCoachAdvice`, because free-tier deltas stream before the service's end-of-response safety check. An unsafe partial is saved as `STANDARD_SAFETY_MESSAGE`.
