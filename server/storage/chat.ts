import {
  type ChatConversation,
  type ChatMessage,
  chatConversations,
  chatMessages,
} from "@shared/schema";
import { db } from "../db";
import { eq, desc, and, gte, lt, sql } from "drizzle-orm";
import { getDayBounds } from "./helpers";

// ============================================================================
// CHAT CONVERSATIONS
// ============================================================================

export async function getChatConversation(
  id: number,
  userId: string,
): Promise<ChatConversation | undefined> {
  const [conversation] = await db
    .select()
    .from(chatConversations)
    .where(
      and(eq(chatConversations.id, id), eq(chatConversations.userId, userId)),
    );
  return conversation || undefined;
}

export async function getChatConversations(
  userId: string,
  limit = 50,
): Promise<ChatConversation[]> {
  return db
    .select()
    .from(chatConversations)
    .where(eq(chatConversations.userId, userId))
    .orderBy(desc(chatConversations.updatedAt))
    .limit(limit);
}

export async function createChatConversation(
  userId: string,
  title: string,
): Promise<ChatConversation> {
  const [conversation] = await db
    .insert(chatConversations)
    .values({ userId, title })
    .returning();
  return conversation;
}

export async function getChatMessages(
  conversationId: number,
  limit = 100,
): Promise<ChatMessage[]> {
  return db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conversationId))
    .orderBy(chatMessages.createdAt)
    .limit(limit);
}

export async function createChatMessage(
  conversationId: number,
  role: string,
  content: string,
  metadata?: unknown,
): Promise<ChatMessage> {
  return db.transaction(async (tx) => {
    const [message] = await tx
      .insert(chatMessages)
      .values({
        conversationId,
        role,
        content,
        metadata: metadata ?? null,
      })
      .returning();

    // Update conversation timestamp atomically
    await tx
      .update(chatConversations)
      .set({ updatedAt: new Date() })
      .where(eq(chatConversations.id, conversationId));

    return message;
  });
}

export async function deleteChatConversation(
  id: number,
  userId: string,
): Promise<boolean> {
  const result = await db
    .delete(chatConversations)
    .where(
      and(eq(chatConversations.id, id), eq(chatConversations.userId, userId)),
    )
    .returning({ id: chatConversations.id });
  return result.length > 0;
}

export async function updateChatConversationTitle(
  id: number,
  userId: string,
  title: string,
): Promise<ChatConversation | undefined> {
  const [updated] = await db
    .update(chatConversations)
    .set({ title, updatedAt: new Date() })
    .where(
      and(eq(chatConversations.id, id), eq(chatConversations.userId, userId)),
    )
    .returning();
  return updated || undefined;
}

export async function getDailyChatMessageCount(
  userId: string,
  date: Date,
): Promise<number> {
  const { startOfDay, endOfDay } = getDayBounds(date);

  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(chatMessages)
    .innerJoin(
      chatConversations,
      eq(chatMessages.conversationId, chatConversations.id),
    )
    .where(
      and(
        eq(chatConversations.userId, userId),
        eq(chatMessages.role, "user"),
        gte(chatMessages.createdAt, startOfDay),
        lt(chatMessages.createdAt, endOfDay),
      ),
    );

  return Number(result[0]?.count ?? 0);
}
