---
title: "Advisory lock for per-user rate limiting"
track: knowledge
category: design-patterns
tags: [database, postgres, drizzle, advisory-lock, race-condition, rate-limit]
module: server
applies_to: ["server/storage/**/*.ts"]
created: 2026-05-13
---

# Advisory lock for per-user rate limiting

## When this applies

When a transaction checks a count and then inserts (TOCTOU pattern), two concurrent transactions can both see the same count and both pass the limit check. PostgreSQL's `READ COMMITTED` isolation doesn't prevent this because each transaction sees its own snapshot.

Use `pg_advisory_xact_lock` to serialize concurrent requests per user within the transaction.

## Examples

```typescript
export async function createChatMessageWithLimitCheck(
  conversationId: number,
  userId: string,
  content: string,
  dailyLimit: number,
  conversationType?: "coach" | "recipe",
): Promise<ChatMessage | null> {
  return db.transaction(async (tx) => {
    // Serialize all generation attempts for this user
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);

    const countResult = await tx
      .select({ count: sql<number>`count(*)` })
      .from(chatMessages)
      .innerJoin(chatConversations, eq(chatMessages.conversationId, chatConversations.id))
      .where(and(
        eq(chatConversations.userId, userId),
        eq(chatMessages.role, "user"),
        gte(chatMessages.createdAt, startOfDay),
        lt(chatMessages.createdAt, endOfDay),
      ));

    if (Number(countResult[0]?.count ?? 0) >= dailyLimit) return null;

    // Safe to insert — no other transaction for this user can be between count and insert
    const [message] = await tx.insert(chatMessages).values({ ... }).returning();
    return message;
  });
}
```

The lock is **transaction-scoped** (`pg_advisory_xact_lock`, not `pg_advisory_lock`) — it releases automatically when the transaction commits or rolls back.

**Use `hashtextextended`, not `hashtext`:** `hashtext()` returns a 32-bit integer — at ~65 000 users the birthday paradox gives a ~1% collision probability (two different users map to the same lock key, silently serializing their requests). `hashtextextended(userId, 0)` returns a 64-bit bigint, reducing the birthday risk to negligible at any realistic user count:

```typescript
await tx.execute(
  sql`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`,
);
```

## When to use

Any count-then-insert pattern where the count must be accurate under concurrent requests (daily limits, rate limiting, inventory checks).

## Why not just `SERIALIZABLE` isolation?

Serializable would also work but requires retry logic for serialization failures. Advisory locks are simpler — they block rather than abort.

## Related Files

- `server/storage/chat.ts` — `createChatMessageWithLimitCheck()`
- `server/storage/favourite-recipes.ts` — `toggleFavouriteRecipe()` (per-user lock on favourite limit check)

## See Also

- [Transaction-wrapped count-then-insert to prevent TOCTOU](transaction-wrapped-count-then-insert-toctou-2026-05-13.md)
- [Early non-transactional check + authoritative transactional check](early-non-transactional-authoritative-transactional-check-2026-05-13.md)
