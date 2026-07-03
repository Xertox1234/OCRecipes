---
title: Client-side turnKey idempotency for AI writes
track: knowledge
category: design-patterns
module: server
tags: [database, idempotency, ai, drizzle, schema, unique-index, chat]
applies_to: [server/storage/**/*.ts, server/services/**/*.ts, shared/schema.ts, client/**/*.ts]
created: '2026-05-13'
---

# Client-side turnKey idempotency for AI writes

## When this applies

When an AI response write can be retried (network drop, duplicate XHR, user resubmit), protect against duplicate `INSERT` using a client-generated `turnKey`.

## Examples

**Schema:** Add a nullable `text` column with a partial unique index:

```typescript
turnKey: text("turn_key"),
// ...
turnKeyUniqueIdx: uniqueIndex("chat_messages_turn_key_idx")
  .on(table.turnKey)
  .where(sql`${table.turnKey} IS NOT NULL`),
```

The partial index (`WHERE NOT NULL`) means rows written without a turnKey (legacy, background jobs) don't occupy index slots.

**Client:** Generate at send time with `crypto.randomUUID()`, include in the request body:

```typescript
const turnKey = crypto.randomUUID();
xhr.send(JSON.stringify({ content: userMessage, turnKey }));
```

**Server:** Before inserting the assistant message, check for an existing row:

```typescript
if (turnKey) {
  const existing = await storage.getChatMessageByTurnKey(
    conversationId,
    turnKey,
  );
  if (existing) return; // already persisted — skip
}
await storage.createChatMessage(
  conversationId,
  userId,
  "assistant",
  text,
  metadata,
  turnKey,
);
```

**IDOR note:** `getChatMessageByTurnKey` only checks `(conversationId, turnKey)` — it relies on the caller having already verified conversation ownership. Document this contract with a comment:

```typescript
export async function getChatMessageByTurnKey( // idor-safe: callers must pre-verify conversation ownership
  conversationId: number,
  turnKey: string,
): Promise<ChatMessage | undefined>;
```

## When to use

Any AI-generated write that can be retried — assistant messages, recipe saves, any `onConflictDoNothing` pattern where the source is a client-triggered operation.

## Related Files

- `shared/schema.ts` — `chatMessages.turnKey`
- `server/storage/chat.ts` — `getChatMessageByTurnKey`
- `server/services/coach-pro-chat.ts` — usage in `handleCoachChat`

## See Also

- [Defensive cache writes with onConflictDoNothing](../conventions/defensive-cache-writes-onconflictdonothing-2026-05-13.md)
- [TOCTOU race recovery via unique constraint catch](toctou-race-recovery-unique-constraint-catch-2026-05-13.md)
