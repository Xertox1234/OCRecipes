import {
  type ChatConversation,
  type ChatMessage,
  type CommunityRecipe,
  chatConversations,
  chatMessages,
  communityRecipes,
  coachResponseCache,
} from "@shared/schema";
import { db } from "../db";
import { eq, desc, and, gte, lt, sql } from "drizzle-orm";
import { getDayBounds } from "./helpers";
import { recipeChatMetadataSchema } from "@shared/schemas/recipe-chat";
import { inferMealTypes } from "../lib/meal-type-inference";

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
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);

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
        const recipeMessageCount = await tx
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
          );

        const remixConvCount = await tx
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
          );

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
      const recipeMessageCount = await tx
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
        );

      const remixConvCount = await tx
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
        );

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
// RECIPE CHAT — SAVE RECIPE FROM CHAT
// ============================================================================

/**
 * Save a recipe from a chat message to communityRecipes.
 * Atomic transaction: verify ownership, check idempotency, create recipe,
 * update message metadata with back-reference.
 *
 * For remix conversations, pass remixedFromId and remixedFromTitle to
 * establish lineage to the original recipe.
 *
 * Returns the created recipe, or the existing one if already saved.
 */
export async function saveRecipeFromChat(
  messageId: number,
  conversationId: number,
  userId: string,
  lineage?: { remixedFromId: number; remixedFromTitle: string },
): Promise<CommunityRecipe | null> {
  return db.transaction(async (tx) => {
    // 1. Verify conversation ownership
    const [conv] = await tx
      .select()
      .from(chatConversations)
      .where(
        and(
          eq(chatConversations.id, conversationId),
          eq(chatConversations.userId, userId),
        ),
      );
    if (!conv) return null;

    // 2. Get the message and check it belongs to this conversation
    const [msg] = await tx
      .select()
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.id, messageId),
          eq(chatMessages.conversationId, conversationId),
        ),
      );
    if (!msg || !msg.metadata) return null;

    // 3. Validate metadata with Zod — no unsafe `as` casts on DB values
    const parsed = recipeChatMetadataSchema.safeParse(msg.metadata);

    // Handle legacy or non-recipe messages: check raw savedRecipeId for idempotency
    const rawMetadata = msg.metadata as Record<string, unknown>;
    if (rawMetadata.savedRecipeId) {
      const [existing] = await tx
        .select()
        .from(communityRecipes)
        .where(eq(communityRecipes.id, Number(rawMetadata.savedRecipeId)));
      return existing || null;
    }

    // 4. Extract validated recipe data from metadata
    if (!parsed.success) return null;
    const { recipe } = parsed.data;

    // 5. Create communityRecipe (private by default). Classify meal types
    //    so the recipe participates in meal-type search filters if later
    //    made public (M9 — community recipes used to hard-code `mealTypes: []`).
    const [created] = await tx
      .insert(communityRecipes)
      .values({
        authorId: userId,
        normalizedProductName: recipe.title.toLowerCase(),
        title: recipe.title,
        description: recipe.description,
        difficulty: recipe.difficulty,
        timeEstimate: recipe.timeEstimate,
        servings: recipe.servings ?? 2,
        dietTags: recipe.dietTags ?? [],
        mealTypes: inferMealTypes(
          recipe.title,
          recipe.ingredients.map((i) => i.name),
        ),
        instructions: recipe.instructions,
        ingredients: recipe.ingredients,
        imageUrl: parsed.data.imageUrl ?? null,
        isPublic: false,
        ...(lineage && {
          remixedFromId: lineage.remixedFromId,
          remixedFromTitle: lineage.remixedFromTitle,
        }),
      })
      .returning();

    // 6. Update message metadata with back-reference
    await tx
      .update(chatMessages)
      .set({
        metadata: sql`${chatMessages.metadata} || ${JSON.stringify({ savedRecipeId: created.id })}::jsonb`,
      })
      .where(eq(chatMessages.id, messageId));

    return created;
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
