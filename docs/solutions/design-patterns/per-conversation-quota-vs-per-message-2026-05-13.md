---
title: "Per-conversation quota (vs per-message) for iterative AI sessions"
track: knowledge
category: design-patterns
tags: [api, quota, ai, chat, premium, drizzle]
module: server
applies_to: ["server/storage/**/*.ts", "shared/types/premium.ts"]
created: 2026-05-13
---

# Per-conversation quota (vs per-message) for iterative AI sessions

## When this applies

Features that are session-based (AI conversations with refinement, collaborative editing sessions) rather than action-based (individual API calls, scans). When a feature allows iterative refinement within a session (e.g., remix conversations), use per-conversation quota instead of per-message. Only the first user message in a conversation counts against the daily limit; subsequent messages are free refinements.

## Why

Recipe Remix users naturally send 3–5 follow-up messages to refine a recipe. Counting each as a generation would burn the daily quota in one conversation and feel punitive. Counting once per conversation matches the user's mental model: "I generated one recipe today, and refined it a few times."

## Examples

```typescript
// In createChatMessageWithLimitCheck, for "remix" type:
if (conversationType === "remix") {
  // Check if this conversation already has a user message
  const existingMsgCount = await tx
    .select({ count: sql`count(*)` })
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.conversationId, conversationId),
        eq(chatMessages.role, "user"),
      ),
    );

  if (Number(existingMsgCount[0]?.count ?? 0) > 0) {
    // Not the first message — skip quota check, refinements are free
  } else {
    // First message — check shared quota pool
  }
}
```

## Symmetric counting is critical

When different conversation types share a quota pool, both paths must count the same way. Recipe messages count per-message; remix conversations count as 1 each. The recipe path must also count remix conversations by distinct ID (not by message count), otherwise the total inflates.

```typescript
// Recipe path: count recipe messages + distinct remix conversations
const recipeMessages = /* count user messages in recipe conversations today */;
const remixConversations = /* count DISTINCT remix conversation IDs with user messages today */;
const totalGenerations = recipeMessages + remixConversations;
```

## Schema note

`chatMessages` has `conversationId` and `role` columns (verified in `shared/schema.ts`). Ownership lives on the parent `chatConversations.userId` via cascade-delete foreign key; this transactional helper checks ownership via the parent join pattern rather than a direct `chatMessages.userId` column.

## Related Files

- `server/storage/chat.ts` — `createChatMessageWithLimitCheck()` remix branch
- `shared/types/premium.ts` — `dailyRecipeGenerations` shared between recipe + remix

## Origin

Recipe Remix feature (2026-04-08).
