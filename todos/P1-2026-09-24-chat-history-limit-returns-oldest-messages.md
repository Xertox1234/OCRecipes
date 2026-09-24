---
title: "getChatMessages(limit) returns the OLDEST N messages — coach/recipe context and chat history drop the newest turns in long conversations"
status: backlog
priority: high
created: 2026-09-24
updated: 2026-09-24
assignee:
labels: [deferred, reliability, ai]
github_issue:
---

# getChatMessages(limit) returns the OLDEST N messages — coach/recipe context and chat history drop the newest turns in long conversations

## Summary

`getChatMessages(conversationId, limit, userId)` orders by `createdAt` ascending and then applies `limit`, so it returns the first N messages of a conversation, not the last N. Every caller that passes a limit to get "recent history" gets stale context once a conversation is longer than the limit.

## Background

Found during the H6 fix (#1060) while tracing coach history. `server/storage/chat.ts` → `getChatMessages` ends in `.orderBy(chatMessages.createdAt).limit(limit)`.

Affected callers:

- `server/services/coach-pro-chat.ts` → `handleCoachChat`: `getChatMessages(conversationId, 20, userId)`. After 20 messages, the coach gets the first 20 turns as context. The current user message was just inserted, so it is the newest row and falls outside the window. It reaches the model only if the service also appends `content` separately; verify this.
- `server/routes/chat.ts` → recipe/remix path: `getChatMessages(id, 10, req.userId)` → `buildRecipeContext`.
- `server/routes/coach-context.ts` (warm-up pre-fetch): limit 20.
- `server/routes/chat.ts` → `GET /api/chat/conversations/:id/messages`: limit 100. A conversation longer than 100 messages shows only its first 100 in the UI, so newer messages never appear.
- The auto-title checks (`history.length <= 1`) are unaffected, because they only look at small counts.

The existing storage test `getChatMessages › respects limit` (`server/storage/__tests__/chat.test.ts`) checks only `toHaveLength(3)`, never WHICH messages come back, so nothing pins the ordering.

## Acceptance Criteria

- [ ] A limited read returns the newest N messages, in chronological (ascending) order for the caller
- [ ] A storage test with > limit messages asserts the exact contents (the newest N, oldest-first). It fails on current `main`.
- [ ] Every caller above is checked. **Decided (user, 2026-09-24): `GET /messages` returns the newest 100** (oldest-first order within them). No pagination.
- [ ] If `handleCoachChat` relies on history already containing the just-inserted user message, the coach test covers a > 20 message conversation

## Implementation Notes

- Typical fix: a subquery ordered `desc(createdAt), desc(id)` with `limit`, then re-sorted ascending. Add the `id` tiebreak, because rows inserted in the same transaction can share a `createdAt`.
- `server/storage/chat.ts` is over the 500-line threshold (docs/rules/architecture.md). Change the existing function in place; don't add a sibling.
- The function has an IDOR join on `chatConversations.userId`. Keep it, and keep the wrong-user test.

## Updates

### 2026-09-24

- **Product decision (user):** return the newest N everywhere, including `GET /messages` (newest 100). Gate removed; ready for `/todo`.
