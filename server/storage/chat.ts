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
import { fireAndForget } from "../lib/fire-and-forget";

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
  type?: "coach" | "recipe" | "remix",
): Promise<ChatConversation[]> {
  const conditions = [eq(chatConversations.userId, userId)];
  if (type) {
    conditions.push(eq(chatConversations.type, type));
  }
  return db
    .select()
    .from(chatConversations)
    .where(and(...conditions))
    .orderBy(desc(chatConversations.updatedAt))
    .limit(limit);
}

export async function createChatConversation(
  userId: string,
  title: string,
  type: "coach" | "recipe" | "remix" = "coach",
  metadata?: Record<string, unknown> | null,
): Promise<ChatConversation> {
  const [conversation] = await db
    .insert(chatConversations)
    .values({ userId, title, type, metadata: metadata ?? null })
    .returning();
  return conversation;
}

export async function getChatMessages(
  conversationId: number,
  limit = 100,
  userId?: string,
): Promise<ChatMessage[]> {
  if (userId) {
    const rows = await db
      .select({ message: chatMessages })
      .from(chatMessages)
      .innerJoin(
        chatConversations,
        eq(chatMessages.conversationId, chatConversations.id),
      )
      .where(
        and(
          eq(chatMessages.conversationId, conversationId),
          eq(chatConversations.userId, userId),
        ),
      )
      .orderBy(chatMessages.createdAt)
      .limit(limit);
    return rows.map((r) => r.message);
  }
  return db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conversationId))
    .orderBy(chatMessages.createdAt)
    .limit(limit);
}

/**
 * Get a single chat message by ID, verifying it belongs to the given
 * conversation. Returns undefined if not found or mismatched.
 *
 * Note: does not verify user ownership of the conversation. Callers must
 * pre-check ownership (e.g., via `getChatConversation(id, userId)`) before
 * using this function.
 */
export async function getChatMessageById( // idor-safe: callers must pre-verify conversation ownership via getChatConversation(id, userId)
  messageId: number,
  conversationId: number,
): Promise<ChatMessage | undefined> {
  const [message] = await db
    .select()
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.id, messageId),
        eq(chatMessages.conversationId, conversationId),
      ),
    );
  return message || undefined;
}

export async function createChatMessage(
  conversationId: number,
  role: string,
  content: string,
  metadata?: Record<string, unknown> | null,
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
 * Counting strategy varies by conversation type:
 * - coach: counts user messages in coach conversations today
 * - recipe/remix: counts recipe user messages + remix conversations today
 *   (remix conversations count as 1 generation regardless of message count)
 *
 * Returns the created message, or null if the daily limit has been reached.
 */
export async function createChatMessageWithLimitCheck(
  conversationId: number,
  userId: string,
  content: string,
  dailyLimit: number,
  conversationType?: "coach" | "recipe" | "remix",
): Promise<ChatMessage | null> {
  return db.transaction(async (tx) => {
    // Advisory lock per user to serialize concurrent generation attempts
    // hashtextextended returns a 64-bit bigint, eliminating the ~65k-user
    // birthday-collision risk of the 32-bit hashtext() form (L31).
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`,
    );

    // Enforce conversation ownership inside the tx so storage is safe to
    // call from any route, not just the ones that pre-check via
    // `getChatConversation(id, userId)`. Without this, a malicious caller
    // who forged `userId` would lock their own advisory slot while writing
    // into another user's conversation. (H11 — 2026-04-18.)
    const ownership = await tx
      .select({ id: chatConversations.id })
      .from(chatConversations)
      .where(
        and(
          eq(chatConversations.id, conversationId),
          eq(chatConversations.userId, userId),
        ),
      )
      .limit(1);
    if (ownership.length === 0) {
      return null;
    }

    const { startOfDay, endOfDay } = getDayBounds(new Date());

    // For remix conversations, only the first user message counts against the
    // shared recipe generation quota. Subsequent messages are free refinements.
    if (conversationType === "remix") {
      // Check if this conversation already has a user message (i.e., not the first)
      const existingMsgResult = await tx
        .select({ count: sql<number>`count(*)` })
        .from(chatMessages)
        .where(
          and(
            eq(chatMessages.conversationId, conversationId),
            eq(chatMessages.role, "user"),
          ),
        );
      const hasExistingMessage = Number(existingMsgResult[0]?.count ?? 0) > 0;

      if (!hasExistingMessage) {
        // First message — check shared recipe+remix generation quota.
        // Count: recipe user messages + distinct remix conversations today.
        // M15 (2026-04-18): run both count queries in parallel to halve
        // advisory-lock hold time.
        const [recipeMessageCount, remixConvCount] = await Promise.all([
          tx
            .select({ count: sql<number>`count(*)` })
            .from(chatMessages)
            .innerJoin(
              chatConversations,
              eq(chatMessages.conversationId, chatConversations.id),
            )
            .where(
              and(
                eq(chatConversations.userId, userId),
                eq(chatConversations.type, "recipe"),
                eq(chatMessages.role, "user"),
                gte(chatMessages.createdAt, startOfDay),
                lt(chatMessages.createdAt, endOfDay),
              ),
            ),
          tx
            .select({
              count: sql<number>`count(DISTINCT ${chatConversations.id})`,
            })
            .from(chatConversations)
            .innerJoin(
              chatMessages,
              eq(chatMessages.conversationId, chatConversations.id),
            )
            .where(
              and(
                eq(chatConversations.userId, userId),
                eq(chatConversations.type, "remix"),
                eq(chatMessages.role, "user"),
                gte(chatConversations.createdAt, startOfDay),
                lt(chatConversations.createdAt, endOfDay),
              ),
            ),
        ]);

        const totalGenerations =
          Number(recipeMessageCount[0]?.count ?? 0) +
          Number(remixConvCount[0]?.count ?? 0);

        if (totalGenerations >= dailyLimit) {
          return null;
        }
      }
      // If hasExistingMessage, skip quota check — refinements are free
    } else if (conversationType === "recipe") {
      // Recipe messages share quota with remix conversations.
      // Count recipe user messages + distinct remix conversations (not remix messages).
      // M15 (2026-04-18): run both count queries in parallel to halve
      // advisory-lock hold time.
      const [recipeMessageCount, remixConvCount] = await Promise.all([
        tx
          .select({ count: sql<number>`count(*)` })
          .from(chatMessages)
          .innerJoin(
            chatConversations,
            eq(chatMessages.conversationId, chatConversations.id),
          )
          .where(
            and(
              eq(chatConversations.userId, userId),
              eq(chatConversations.type, "recipe"),
              eq(chatMessages.role, "user"),
              gte(chatMessages.createdAt, startOfDay),
              lt(chatMessages.createdAt, endOfDay),
            ),
          ),
        tx
          .select({
            count: sql<number>`count(DISTINCT ${chatConversations.id})`,
          })
          .from(chatConversations)
          .innerJoin(
            chatMessages,
            eq(chatMessages.conversationId, chatConversations.id),
          )
          .where(
            and(
              eq(chatConversations.userId, userId),
              eq(chatConversations.type, "remix"),
              eq(chatMessages.role, "user"),
              gte(chatConversations.createdAt, startOfDay),
              lt(chatConversations.createdAt, endOfDay),
            ),
          ),
      ]);

      const totalGenerations =
        Number(recipeMessageCount[0]?.count ?? 0) +
        Number(remixConvCount[0]?.count ?? 0);

      if (totalGenerations >= dailyLimit) {
        return null;
      }
    } else {
      // Coach type — per-message counting
      const conditions = [
        eq(chatConversations.userId, userId),
        eq(chatMessages.role, "user"),
        gte(chatMessages.createdAt, startOfDay),
        lt(chatMessages.createdAt, endOfDay),
      ];
      if (conversationType) {
        conditions.push(eq(chatConversations.type, conversationType));
      }

      const countResult = await tx
        .select({ count: sql<number>`count(*)` })
        .from(chatMessages)
        .innerJoin(
          chatConversations,
          eq(chatMessages.conversationId, chatConversations.id),
        )
        .where(and(...conditions));

      const currentCount = Number(countResult[0]?.count ?? 0);
      if (currentCount >= dailyLimit) {
        return null;
      }
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
 * Get a cached coach response by user + question hash.
 * Returns null if not found or expired. Increments hit count on cache hit.
 */
export async function getCoachCachedResponse(
  userId: string,
  questionHash: string,
): Promise<string | null> {
  const [cached] = await db
    .select({
      id: coachResponseCache.id,
      response: coachResponseCache.response,
    })
    .from(coachResponseCache)
    .where(
      and(
        eq(coachResponseCache.userId, userId),
        eq(coachResponseCache.questionHash, questionHash),
        gte(coachResponseCache.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!cached) return null;

  fireAndForget(
    "coach-cache-hit-count",
    db
      .update(coachResponseCache)
      .set({ hitCount: sql`${coachResponseCache.hitCount} + 1` })
      .where(eq(coachResponseCache.id, cached.id)),
  );

  return cached.response;
}

/**
 * Cache a coach response for a predefined question.
 * Uses upsert to handle concurrent first-asks.
 */
export async function setCoachCachedResponse(
  userId: string,
  questionHash: string,
  question: string,
  response: string,
  ttlDays = 7,
): Promise<void> {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + ttlDays);

  await db
    .insert(coachResponseCache)
    .values({ userId, questionHash, question, response, expiresAt })
    .onConflictDoUpdate({
      target: [coachResponseCache.userId, coachResponseCache.questionHash],
      set: { response, expiresAt, hitCount: 0 },
    });
}
