---
title: Validate storage-layer write ownership for chat messages
track: knowledge
category: conventions
module: server
tags: [security, idor, chat, storage, transactional]
applies_to: [server/storage/chat.ts, server/storage/**/*.ts]
created: '2026-05-13'
---

# Validate storage-layer write ownership for chat messages

## Rule

`createChatMessage` (and any storage function that inserts rows attached to a parent entity) must verify that the authenticated user owns the parent before inserting. Accepting only `conversationId` without a user ownership predicate creates an IDOR vector where an attacker can inject messages into another user's conversation by guessing or enumerating conversation IDs.

## Pattern

Inside a transaction, confirm the parent row exists AND belongs to the caller's `userId` before inserting the child row. Also validate the `role` value at the storage boundary — never pass arbitrary role strings through from upstream.

## Examples

```typescript
// ✅ CORRECT
async function createChatMessage(
  conversationId: number,
  userId: string, // ← required
  role: "user" | "assistant" | "system", // ← typed, not string
  content: string,
) {
  return db.transaction(async (tx) => {
    const [conv] = await tx
      .select({ id: chatConversations.id })
      .from(chatConversations)
      .where(
        and(
          eq(chatConversations.id, conversationId),
          eq(chatConversations.userId, userId), // ← ownership check
        ),
      )
      .limit(1);
    if (!conv) throw new Error("Conversation not found");
    await tx.insert(chatMessages).values({ conversationId, role, content });
    await tx
      .update(chatConversations)
      .set({ updatedAt: new Date() })
      .where(
        and(
          eq(chatConversations.id, conversationId),
          eq(chatConversations.userId, userId), // ← ownership on update too
        ),
      );
  });
}
```

## Related Files

- `server/storage/chat.ts` — `createChatMessage` with `userId` param and ownership predicate
- Origin: 2026-04-29 audit L1

## See Also

- [Storage-layer defense-in-depth for IDOR](storage-layer-idor-defense-in-depth-2026-05-13.md)
- [IDOR protection: auth + ownership check](idor-protection-auth-ownership-check-2026-05-13.md)
- [Wire optional defense-in-depth parameters at every call site](wire-optional-defense-in-depth-parameters-2026-05-13.md)
