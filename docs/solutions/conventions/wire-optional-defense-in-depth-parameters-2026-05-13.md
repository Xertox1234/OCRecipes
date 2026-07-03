---
title: Wire optional defense-in-depth parameters at every call site
track: knowledge
category: conventions
module: server
tags: [security, idor, storage, defense-in-depth, refactor]
applies_to: [server/storage/**/*.ts, server/routes/**/*.ts, server/services/**/*.ts]
created: '2026-05-13'
---

# Wire optional defense-in-depth parameters at every call site

## Rule

When a storage function gains an optional `userId` parameter for defense-in-depth, every existing call site that has `userId` in scope must pass it — even if that call site already pre-verifies ownership at the route level. An optional parameter that no caller passes is effectively dead code: the storage-layer guard is present but never activated.

## Examples

```typescript
// Storage function updated with optional userId (ownership enforced via parent join):
export async function getChatMessages(
  conversationId: number,
  limit: number,
  userId?: string, // ← added for defense-in-depth
): Promise<ChatMessage[]> {
  return db
    .select({ message: chatMessages })
    .from(chatMessages)
    .innerJoin(
      chatConversations,
      eq(chatMessages.conversationId, chatConversations.id),
    )
    .where(
      and(
        eq(chatMessages.conversationId, conversationId),
        userId ? eq(chatConversations.userId, userId) : undefined,
      ),
    );
}

// ❌ BAD: Call site has userId but doesn't pass it — defense is aspirational only
const conversation = await storage.getChatConversation(id, req.userId); // pre-check
if (!conversation) return sendError(...);
const messages = await storage.getChatMessages(id, 100); // userId ignored!

// ✅ GOOD: Pass userId — storage layer independently enforces ownership
const messages = await storage.getChatMessages(id, 100, req.userId);
```

> **Schema note:** `chatMessages` does not carry `userId` directly; ownership lives on the parent `chatConversations.userId`. The `innerJoin` is what makes the optional `userId` clause meaningful. For a function whose target table _does_ carry `userId`, the join disappears and the where-clause becomes `eq(<table>.userId, userId)` directly — but the rule about wiring optional params at every call site is the same. (In production, `getChatMessages` ultimately required `userId` to make this pitfall a compile-time error — see _Origin_ below.)

**Rule of thumb:** After adding an optional `userId` to any storage function, immediately grep all call sites and update every one where `userId` (or `req.userId`) is in scope. If a call site genuinely cannot provide `userId` (e.g., a migration script, a background job), document why in a comment.

## Why

Making the parameter optional preserves backwards compatibility for internal tools and migration scripts. But route handlers always have `req.userId` — there is no reason to omit it there. Without a convention to wire it, the parameter accumulates technical debt: the function signature looks hardened, the tests pass, but the guard never fires in production.

**Origin:** 2026-04-28 audit security todo added `userId` to `getChatMessages` as optional — but all 4 production call sites continued passing 2 arguments. The defense-in-depth was only realized after a session-level code review caught the gap.

## Related Files

- `server/storage/chat.ts` — `getChatMessages(conversationId, limit, userId?)`
- `server/routes/chat.ts`, `server/routes/coach-context.ts`, `server/services/coach-pro-chat.ts` — wired in commit `23d6e82`

## See Also

- [Storage-layer defense-in-depth for IDOR](storage-layer-idor-defense-in-depth-2026-05-13.md)
