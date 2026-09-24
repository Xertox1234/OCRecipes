---
title: "Recipe/remix chat: make finish-and-save on disconnect explicit, and show the finished reply when the user returns"
status: backlog
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
- [ ] The user sees the finished reply on returning to the recipe chat, or when browsing previous chats. That means no stale cache: when the recipe chat unmounts or its stream is intentionally aborted, the conversation's messages and the conversation list are marked stale (`refetchType: "none"`, same pattern as `CoachOverlayContent` / `CoachChat` in #1060).
- [ ] A server real-socket test (`postAndDisconnect` in `server/routes/__tests__/chat.test.ts`) pins it: a recipe turn disconnected mid-stream still saves its assistant message (with recipe metadata) exactly once, and does not refund
- [ ] Dead abort assumptions on the recipe path are removed or commented. Its `if (!aborted && …)` persistence gates can only be tripped by the SSE timeout / byte limit now, so say so.
- [ ] Client test: unmount / intentional abort mid-stream invalidates both query keys

## Implementation Notes

- Client: `client/hooks/useChat.ts` → `useSendMessage` skips its `invalidateQueries` when the XHR was intentionally aborted (`xhr.onabort` sets `aborted`, then the post-stream `!aborted &&` guard). Because the server now keeps going, that abort path needs a stale-mark as well. Check `client/screens/RecipeChatScreen.tsx` for its unmount cleanup.
- Server: the `res.on("close")` handler in `server/routes/chat.ts` already returns early for `!isCoachPath`, so the server already finishes and saves today. This todo pins that behavior with a test and makes the client show the result.

- `server/routes/chat.ts`: the `res.on("close")` handler returns early when `!isCoachPath`. Extend it, and the post-stream H6 settle block, if the recipe path gets a policy.
- Refunding means `storage.deleteChatMessage(message.id, userId)`. For recipe it removes one counted row. For remix only the first user message counts, and it counts through `count(DISTINCT conversation)`.

## Updates

### 2026-09-24

- **Product decision (user):** keep finishing; the user must see the finished message when returning to the chat or browsing previous chats. Gate removed; ready for `/todo`.
