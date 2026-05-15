---
title: "Fix first message silently dropped in RecipeChatScreen"
status: backlog
priority: high
created: 2026-04-02
updated: 2026-04-02
assignee:
labels: [bug, recipe-chat]
---

# Fix first message silently dropped in RecipeChatScreen

## Summary

The first message in a new recipe chat conversation is silently dropped due to a stale closure on `conversationId`. This breaks every first interaction in the Recipe Chat screen.

## Background

In `client/screens/RecipeChatScreen.tsx`, `handleSend` creates a new conversation via `setConversationId(convId)` then immediately calls `sendMessage(content)`. Since `setConversationId` is async (React setState), `sendMessage` from `useSendMessage(conversationId)` still closes over the stale `conversationId = null`. The guard `if (!conversationId) return;` in the hook silently drops the message.

Found during code review of PR #33.

## Acceptance Criteria

- [ ] First message in a new recipe chat conversation is successfully sent to the server
- [ ] Suggestion chip taps trigger recipe generation (not silently dropped)
- [ ] Existing coach chat first-message flow is unaffected

## Implementation Notes

Two approaches:

**Option A (preferred):** Add an optional `conversationIdOverride` parameter to `sendMessage` in `useSendMessage`:

```typescript
const sendMessage = useCallback(
  async (
    content: string,
    screenContext?: string,
    conversationIdOverride?: number,
  ) => {
    const effectiveId = conversationIdOverride ?? conversationId;
    if (!effectiveId) return;
    // ... use effectiveId instead of conversationId
  },
  [conversationId, queryClient],
);
```

Then in `RecipeChatScreen.handleSend`: `sendMessage(content, undefined, convId);`

**Option B:** Use a ref to track the conversation ID alongside state, so the callback always reads the latest value.

## Dependencies

- None — self-contained fix

## Updates

### 2026-04-02

- Created from PR #33 code review finding (Bug 1, High)
