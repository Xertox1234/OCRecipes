---
title: "Recipe/remix chat: make finish-and-save on disconnect explicit, and show the finished reply when the user returns"
status: done
priority: medium
created: 2026-09-24
updated: 2026-09-24
assignee:
labels: [deferred, reliability, product-decision]
github_issue:
---

# Recipe/remix chat: make finish-and-save on disconnect explicit, and show the finished reply when the user returns

## Summary

On the recipe/remix path of `POST /api/chat/conversations/:id/messages`, a client disconnect never aborts the OpenAI call. Generation (and the image pipeline) runs to completion and the reply is saved, so every abandoned turn pays full token cost.

## Background

Deferred from the H6 fix (`todos/P1-2026-09-23-ask-coach-dismiss-mid-stream-burns-quota.md`). The M8 abort used `req.on("close")`, which never fires on Node 24 once `express.json()` has consumed the body. H6 moved detection to `res.on("close")` + `!res.writableFinished` for the **coach path only**. Recipe/remix was left on finish-and-save on purpose: aborting it without a salvage policy would recreate H6 there (the quota row is spent and no reply is saved), and half a recipe JSON cannot be saved as a partial.

## Acceptance Criteria

- [x] Product decision recorded (user, 2026-09-24): **keep finishing.** A recipe/remix turn whose client disconnects runs to completion server-side and saves the full reply; no abort, no refund.
- [x] The user sees the finished reply on returning to the recipe chat, or when browsing previous chats. That means no stale cache: when the recipe chat unmounts or its stream is intentionally aborted, the conversation's messages and the conversation list are marked stale (`refetchType: "none"`, same pattern as `CoachOverlayContent` / `CoachChat` in #1060).
- [x] A server real-socket test (`postAndDisconnect` in `server/routes/__tests__/chat.test.ts`) pins it: a recipe turn disconnected mid-stream still saves its assistant message (with recipe metadata) exactly once, and does not refund
- [x] Dead abort assumptions on the recipe path are removed or commented. Its `if (!aborted && …)` persistence gates can only be tripped by the SSE timeout / byte limit now, so say so.
- [x] Client test: unmount / intentional abort mid-stream invalidates both query keys

## Implementation Notes

- Client: `client/hooks/useChat.ts` → `useSendMessage` skips its `invalidateQueries` when the XHR was intentionally aborted (`xhr.onabort` sets `aborted`, then the post-stream `!aborted &&` guard). Because the server now keeps going, that abort path needs a stale-mark as well. Check `client/screens/RecipeChatScreen.tsx` for its unmount cleanup.
- Server: the `res.on("close")` handler in `server/routes/chat.ts` already returns early for `!isCoachPath`, so the server already finishes and saves today. This todo pins that behavior with a test and makes the client show the result.

- `server/routes/chat.ts`: the `res.on("close")` handler returns early when `!isCoachPath`. Extend it, and the post-stream H6 settle block, if the recipe path gets a policy.
- Refunding means `storage.deleteChatMessage(message.id, userId)`. For recipe it removes one counted row. For remix only the first user message counts, and it counts through `count(DISTINCT conversation)`.

## Updates

### 2026-09-24

- **Product decision (user):** keep finishing; the user must see the finished message when returning to the chat or browsing previous chats. Gate removed; ready for `/todo`.

### 2026-09-24 (implemented)

- **Client:** `useSendMessage` (`client/hooks/useChat.ts`) now exposes `abortStream()` (wraps the in-flight XHR via a ref) and, on an intentional abort, marks both `[/api/chat/conversations/:id/messages]` and `[/api/chat/conversations]` stale via `invalidateQueries({ refetchType: "none" })` instead of skipping invalidation entirely — same pattern as `CoachOverlayContent`/`CoachChat` (#1060). `RecipeChatScreen.tsx` calls `abortStream()` from an unmount effect.
- **Server:** no behavior change — `server/routes/chat.ts` already finished and saved on the recipe/remix path (`isCoachPath` gates the H6 `res.on("close")` handler). Added comments at the two `if (!aborted && …)` persistence gates and the loop-break check documenting that `aborted` there can now only trip via the SSE timeout or the byte-limit guard, never a disconnect.
- **Server test:** `postAndDisconnect` (`server/routes/__tests__/chat.test.ts`) gained an optional `onServerClose` hook — the recipe/remix generator receives no `AbortSignal` (unlike coach's `untilAborted(signal)`), so the new pin test pauses its fake generator on the harness's own `res.on("close")` observation instead. **Non-vacuity measured**: temporarily removing the `|| !isCoachPath` guard made the new test fail (`assistantWrites()` length 0 instead of 1) before reverting.
- **Client test:** `useChat.test.ts` covers the stale-mark-on-abort path (and a no-op-when-idle control); `RecipeChatScreen.test.tsx` covers the unmount → `abortStream()` wiring.
- **Review:** `code-reviewer` + `server-reviewer` + `mobile-reviewer`, one pass, no CRITICAL findings. Two non-blocking notes carried to the PR: (1) a narrow timing gap — an unmount during `sendMessage`'s `tokenStorage.get()` await (before the XHR exists) makes `abortStream()` a no-op for that turn, no data loss, just misses that turn's stale-mark; (2) `xhrRef` is last-write-wins across overlapping `sendMessage` calls on one hook instance (same shape as `useCoachStream.ts`'s existing `abortStream`; not reachable via the UI since the send button disables while streaming).
- **Known residual (accepted, not fixed here):** `refetchType: "none"` marks stale but only refetches on the next query mount. Recipe/remix generation runs for tens of seconds (recipe + image), longer than coach's near-instant settle, so a user who reopens the conversation before generation finishes still sees the pre-completion snapshot for the remaining `staleTime` window. Same shape as the accepted #1060 behavior, just a longer window on this path.
