---
title: "Type discriminator column for shared tables"
track: knowledge
category: design-patterns
tags: [database, drizzle, schema, discriminator, shared-tables, indexes]
module: server
applies_to:
  ["shared/schema.ts", "server/storage/**/*.ts", "server/routes/**/*.ts"]
created: 2026-05-13
---

# Type discriminator column for shared tables

## When this applies

When two features share the same data model (e.g., coach chat and recipe chat both use conversations + messages), add a `type` text column with a default value instead of creating parallel tables.

## Examples

```typescript
// Schema — add type with a default so existing rows are backward-compatible
export const chatConversations = pgTable(
  "chat_conversations",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id")
      .references(() => users.id)
      .notNull(),
    title: text("title").notNull(),
    type: text("type").notNull().default("coach"), // 'coach' | 'recipe'
    // ...
  },
  (table) => ({
    userTypeIdx: index("chat_conversations_user_type_idx").on(
      table.userId,
      table.type,
    ),
  }),
);

// Storage — filter by type
export async function getChatConversations(
  userId: string,
  limit = 50,
  type?: "coach" | "recipe",
) {
  const conditions = [eq(chatConversations.userId, userId)];
  if (type) conditions.push(eq(chatConversations.type, type));
  return db
    .select()
    .from(chatConversations)
    .where(and(...conditions))
    .orderBy(desc(chatConversations.updatedAt))
    .limit(limit);
}

// Route — dispatch to different services based on type
if (conversation.type === "recipe") {
  // Recipe chat path — different AI service, different context building
} else {
  // Coach chat path — existing behavior
}
```

## When to use

Two features that share the same entity structure (same columns, same relationships) but have different behavior. Classic examples: chat types, notification types, log categories.

## Exceptions

When the data models diverge significantly (different columns, different relationships). In that case, separate tables are cleaner.

## Why

Avoids duplicating CRUD operations, storage functions, hooks, and route handlers. The shared infrastructure handles the common case; only the behavior-specific logic (AI service, context building) is branched.

## Related Files

- `shared/schema.ts` — `chatConversations.type` column
- `server/routes/chat.ts` — type-aware dispatch in message endpoint
- `client/hooks/useChat.ts` — `useChatConversations(type?)` with type in query key
