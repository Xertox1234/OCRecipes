import {
  type ChatConversation,
  type ChatMessage,
  chatConversations,
  chatMessages,
  coachResponseCache,
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
  metadata?: Record<string, string | number | boolean | null> | null,
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

/**
 * Atomically check the daily message limit and create a chat message.
 * Wraps count-check + insert in a single transaction to prevent TOCTOU races
 * where concurrent requests could bypass the daily limit.
 *
 * Returns the created message, or null if the daily limit has been reached.
 */
export async function createChatMessageWithLimitCheck(
  conversationId: number,
  userId: string,
  content: string,
  dailyLimit: number,
): Promise<ChatMessage | null> {
  return db.transaction(async (tx) => {
    const { startOfDay, endOfDay } = getDayBounds(new Date());

    const countResult = await tx
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

    const currentCount = Number(countResult[0]?.count ?? 0);
    if (currentCount >= dailyLimit) {
      return null;
    }

    const [message] = await tx
      .insert(chatMessages)
      .values({
        conversationId,
        role: "user",
        content,
        metadata: null,
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

// ============================================================================
// COACH RESPONSE CACHE
// ============================================================================

/**
 * Get a cached coach response by question hash.
 * Returns null if not found or expired. Increments hit count on cache hit.
 */
export async function getCoachCachedResponse(
  questionHash: string,
): Promise<string | null> {
  const [cached] = await db
    .select()
    .from(coachResponseCache)
    .where(
      and(
        eq(coachResponseCache.questionHash, questionHash),
        gte(coachResponseCache.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!cached) return null;

  // Fire-and-forget hit count increment
  db.update(coachResponseCache)
    .set({ hitCount: sql`${coachResponseCache.hitCount} + 1` })
    .where(eq(coachResponseCache.id, cached.id))
    .catch(() => {});

  return cached.response;
}

/**
 * Cache a coach response for a predefined question.
 * Uses upsert to handle concurrent first-asks.
 */
export async function setCoachCachedResponse(
  questionHash: string,
  question: string,
  response: string,
  ttlDays = 7,
): Promise<void> {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + ttlDays);

  await db
    .insert(coachResponseCache)
    .values({ questionHash, question, response, expiresAt })
    .onConflictDoUpdate({
      target: coachResponseCache.questionHash,
      set: { response, expiresAt, hitCount: 0 },
    });
}
