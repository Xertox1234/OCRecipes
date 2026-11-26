import {
  type ChatConversation,
  type ChatMessage,
  chatConversations,
  chatMessageReports,
  chatMessages,
  coachResponseCache,
  pendingReminders,
} from "@shared/schema";
import type { ChatMessageReportReason } from "@shared/constants/chat-message-report";
import { db } from "../db";
import {
  eq,
  desc,
  and,
  gte,
  lt,
  sql,
  inArray,
  ilike,
  isNull,
} from "drizzle-orm";
import { escapeLike } from "./helpers";
import {
  ConversationLimitError,
  MAX_CONVERSATIONS_PER_USER,
} from "./chat-errors";
import { quotaDayBounds } from "./quota-day";
import { fireAndForget } from "../lib/fire-and-forget";
import {
  countCoachClaimsToday,
  countMessageClaimsToday,
  countRecipeGenerationsToday,
  lockUser,
  recordMessageClaim,
  REMIX_REFINEMENTS_PER_GENERATION,
  type MessageClaimKind,
} from "./chat-quota";

type ChatMessageRole = "user" | "assistant" | "system";

function assertChatMessageRole(role: string): asserts role is ChatMessageRole {
  if (role !== "user" && role !== "assistant" && role !== "system") {
    throw new Error(`Invalid chat message role: ${role}`);
  }
}

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

export async function getChatMessageCount(
  conversationId: number,
  userId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(chatMessages)
    .innerJoin(
      chatConversations,
      and(
        eq(chatMessages.conversationId, chatConversations.id),
        eq(chatConversations.userId, userId),
      ),
    )
    .where(eq(chatMessages.conversationId, conversationId));
  return row?.count ?? 0;
}

export async function getChatConversations(
  userId: string,
  limit = 50,
  type?: "coach" | "recipe" | "remix",
  opts?: { search?: string; page?: number },
): Promise<ChatConversation[]> {
  const page = opts?.page ?? 1;
  const offset = (page - 1) * limit;
  const conditions = [eq(chatConversations.userId, userId)];
  if (type) conditions.push(eq(chatConversations.type, type));
  if (opts?.search) {
    conditions.push(
      ilike(chatConversations.title, `%${escapeLike(opts.search)}%`),
    );
  }
  return db
    .select()
    .from(chatConversations)
    .where(and(...conditions))
    .orderBy(
      desc(chatConversations.isPinned),
      desc(chatConversations.pinnedAt),
      desc(chatConversations.updatedAt),
    )
    .limit(limit)
    .offset(offset);
}

export { ConversationLimitError, MAX_CONVERSATIONS_PER_USER };

/**
 * Throws ConversationLimitError once the user holds
 * MAX_CONVERSATIONS_PER_USER. The count and the insert run under the user's
 * advisory lock, so two creates at once cannot both pass the count.
 */
export async function createChatConversation(
  userId: string,
  title: string,
  type: "coach" | "recipe" | "remix" = "coach",
  metadata?: Record<string, unknown> | null,
): Promise<ChatConversation> {
  return db.transaction(async (tx) => {
    await lockUser(tx, userId);
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(chatConversations)
      .where(eq(chatConversations.userId, userId));
    if (n >= MAX_CONVERSATIONS_PER_USER) throw new ConversationLimitError();
    const [conversation] = await tx
      .insert(chatConversations)
      .values({ userId, title, type, metadata: metadata ?? null })
      .returning();
    return conversation;
  });
}

type AdjustLike = {
  type?: unknown;
  avoiding?: unknown;
  noted?: Record<string, unknown>;
};

/** The adjust card with the allergy list and diet type removed. */
function withoutAdjustHealth(block: unknown): unknown {
  const b = block as AdjustLike | null;
  if (!b || typeof b !== "object" || b.type !== "recipe_adjust") return block;
  const { dietType: _diet, ...noted } = b.noted ?? {};
  return { ...b, avoiding: [], noted };
}

/**
 * Clears the user's allergy list and diet type from the recipe adjust cards
 * saved in their chat history, on the withdrawal's own transaction (audit
 * 2026-11-24, L92). The card copies both from the profile; it is saved as
 * `metadata.finder` (recipe chat) or inside `metadata.blocks` (Coach). The
 * rest of the card, and every other block, stays as it was.
 */
export async function clearAdjustCardHealthData(
  userId: string,
  executor: Pick<typeof db, "select" | "update">,
): Promise<void> {
  const rows = await executor
    .select({ id: chatMessages.id, metadata: chatMessages.metadata })
    .from(chatMessages)
    .innerJoin(
      chatConversations,
      eq(chatConversations.id, chatMessages.conversationId),
    )
    .where(
      and(
        eq(chatConversations.userId, userId),
        sql`(${chatMessages.metadata} -> 'finder' ->> 'type' = 'recipe_adjust'
          OR ${chatMessages.metadata} -> 'blocks' @> '[{"type":"recipe_adjust"}]'::jsonb)`,
      ),
    );
  // One row at a time on the one transaction client (database rules).
  for (const row of rows) {
    const meta = row.metadata as Record<string, unknown>;
    const next: Record<string, unknown> = { ...meta };
    if ("finder" in meta) next.finder = withoutAdjustHealth(meta.finder);
    if (Array.isArray(meta.blocks)) {
      next.blocks = meta.blocks.map(withoutAdjustHealth);
    }
    await executor
      .update(chatMessages)
      .set({ metadata: next })
      .where(eq(chatMessages.id, row.id));
  }
}

/**
 * A Coach conversation that opens with a message from the Coach, written by a
 * scheduled job (nobody sent anything). One transaction, so a conversation
 * never exists without its opening message.
 */
export async function createConversationWithAssistantMessage(
  userId: string,
  title: string,
  content: string,
  messageMetadata: Record<string, unknown>,
): Promise<ChatConversation> {
  return db.transaction(async (tx) => {
    const [conversation] = await tx
      .insert(chatConversations)
      .values({ userId, title, type: "coach", metadata: null })
      .returning();
    await tx.insert(chatMessages).values({
      conversationId: conversation.id,
      role: "assistant",
      content,
      metadata: messageMetadata,
    });
    return conversation;
  });
}

export async function getChatMessages(
  conversationId: number,
  limit = 100,
  userId: string,
): Promise<ChatMessage[]> {
  // Fetch the newest `limit` rows (desc, with an `id` tiebreak since rows
  // inserted in the same transaction can share a `createdAt`), then reverse
  // in memory to hand the caller chronological (oldest-first) order. A plain
  // ascending `.orderBy(createdAt).limit(limit)` would instead return the
  // OLDEST `limit` rows, silently dropping the newest turns once a
  // conversation grows past `limit` messages.
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
    .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
    .limit(limit);
  return rows.map((r) => r.message).reverse();
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
  userId: string,
  role: ChatMessageRole,
  content: string,
  metadata?: Record<string, unknown> | null,
  turnKey?: string,
): Promise<ChatMessage> {
  assertChatMessageRole(role);
  return db.transaction(async (tx) => {
    const [conversation] = await tx
      .select({ id: chatConversations.id })
      .from(chatConversations)
      .where(
        and(
          eq(chatConversations.id, conversationId),
          eq(chatConversations.userId, userId),
        ),
      )
      .limit(1);

    if (!conversation) {
      throw new Error("Conversation not found");
    }

    const [message] = await tx
      .insert(chatMessages)
      .values({
        conversationId,
        role,
        content,
        metadata: metadata ?? null,
        ...(turnKey ? { turnKey } : {}),
      })
      .returning();

    // Update conversation timestamp atomically
    await tx
      .update(chatConversations)
      .set({ updatedAt: new Date() })
      .where(
        and(
          eq(chatConversations.id, conversationId),
          eq(chatConversations.userId, userId),
        ),
      );

    return message;
  });
}

export async function getChatMessageByTurnKey( // idor-safe: callers must pre-verify conversation ownership via getChatConversation(id, userId)
  conversationId: number,
  turnKey: string,
): Promise<ChatMessage | undefined> {
  const [message] = await db
    .select()
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.conversationId, conversationId),
        eq(chatMessages.turnKey, turnKey),
      ),
    )
    .limit(1);
  return message;
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

export async function deleteChatMessage(
  messageId: number,
  userId: string,
): Promise<boolean> {
  const result = await db
    .delete(chatMessages)
    .where(
      and(
        eq(chatMessages.id, messageId),
        inArray(
          chatMessages.conversationId,
          db
            .select({ id: chatConversations.id })
            .from(chatConversations)
            .where(eq(chatConversations.userId, userId)),
        ),
      ),
    )
    .returning({ id: chatMessages.id });
  return result.length > 0;
}

/**
 * Save a person's report on an AI reply (privacy audit 2026-11-10, G7): the
 * reply's id, the reason and who reported, never the text. False when the
 * reply is not an assistant message in one of this person's own conversations
 * (IDOR: the ownership check is part of the insert). A repeat report keeps the
 * first row and still returns true.
 */
export async function reportChatMessage(
  messageId: number,
  userId: string,
  reason: ChatMessageReportReason,
): Promise<boolean> {
  const [owned] = await db
    .select({ id: chatMessages.id })
    .from(chatMessages)
    .innerJoin(
      chatConversations,
      eq(chatMessages.conversationId, chatConversations.id),
    )
    .where(
      and(
        eq(chatMessages.id, messageId),
        eq(chatMessages.role, "assistant"),
        eq(chatConversations.userId, userId),
      ),
    )
    .limit(1);
  if (!owned) return false;

  await db
    .insert(chatMessageReports)
    .values({ userId, messageId, reason })
    .onConflictDoNothing({
      target: [chatMessageReports.userId, chatMessageReports.messageId],
    });
  return true;
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

export async function pinChatConversation(
  id: number,
  userId: string,
  isPinned: boolean,
): Promise<ChatConversation | undefined> {
  const [updated] = await db
    .update(chatConversations)
    .set({
      isPinned,
      pinnedAt: isPinned ? new Date() : null,
    })
    .where(
      and(eq(chatConversations.id, id), eq(chatConversations.userId, userId)),
    )
    .returning();
  return updated || undefined;
}

/**
 * Atomically check the daily message limit and create a chat message.
 * Wraps count-check + insert in a single transaction to prevent TOCTOU races
 * where concurrent requests could bypass the daily limit.
 *
 * Counting strategy varies by conversation type:
 * - coach: counts user messages in coach conversations today
 * - recipe/remix: countRecipeGenerationsToday (chat-quota.ts) — recipe user
 *   messages that are not recipe-finder steps, finder Generates claimed in any
 *   conversation, and remix conversations today (each remix counts as 1
 *   generation regardless of message count)
 *
 * Returns the created message, or null if the daily limit has been reached.
 */
export async function createChatMessageWithLimitCheck(
  conversationId: number,
  userId: string,
  content: string,
  dailyLimit: number,
  conversationType?: "coach" | "recipe" | "remix",
  /**
   * Coach only: leave recipe-finder tap rows (`metadata.finderInput`) out of
   * the count — only typed messages count. The caller decides (offer flag).
   */
  opts?: {
    excludeFinderTaps?: boolean;
    /**
     * Coach: the opening brief the user is answering. Saved here, first, only
     * when the limit passes and the conversation is still empty, and the
     * user's reminders are cleared with it. Outside this transaction a 429
     * left the brief saved and the reminders gone, and two first sends could
     * both add one (audit 2026-11-24, L98).
     */
    openingBrief?: { content: string; metadata: Record<string, unknown> };
  },
): Promise<ChatMessage | null> {
  return db.transaction(async (tx) => {
    // Advisory lock per user to serialize concurrent generation attempts.
    await lockUser(tx, userId);

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

    const { startOfDay, endOfDay } = await quotaDayBounds(tx, userId);

    // The claim this message records once it is inserted.
    let claimKind: MessageClaimKind;

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
        // First message — check the shared recipe generation quota
        // (recipe + finder Generate + remix; chat-quota.ts).
        const totalGenerations = await countRecipeGenerationsToday(tx, userId);

        if (totalGenerations >= dailyLimit) {
          return null;
        }
      }
      // Refinements are free, up to a daily bound: each one is a full
      // generation with a picture (audit 2026-11-24, M48).
      if (
        hasExistingMessage &&
        (await countMessageClaimsToday(tx, userId, "remix_refinement")) >=
          dailyLimit * REMIX_REFINEMENTS_PER_GENERATION
      ) {
        return null;
      }
      claimKind = hasExistingMessage ? "remix_refinement" : "remix_generation";
    } else if (conversationType === "recipe") {
      // Recipe messages share one quota with finder Generates and remix
      // conversations (chat-quota.ts).
      const totalGenerations = await countRecipeGenerationsToday(tx, userId);

      if (totalGenerations >= dailyLimit) {
        return null;
      }
      claimKind = "recipe_message";
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
      if (opts?.excludeFinderTaps) {
        conditions.push(
          sql`coalesce(${chatMessages.metadata}->>'finderInput', 'false') <> 'true'`,
        );
      }

      const countResult = await tx
        .select({ count: sql<number>`count(*)` })
        .from(chatMessages)
        .innerJoin(
          chatConversations,
          eq(chatMessages.conversationId, chatConversations.id),
        )
        .where(and(...conditions));

      // Never below today's claims: deleting a message or its conversation
      // does not hand the slot back (audit 2026-11-24, H4).
      const currentCount = Math.max(
        Number(countResult[0]?.count ?? 0),
        await countCoachClaimsToday(tx, userId, {
          includeTaps: !opts?.excludeFinderTaps,
        }),
      );
      if (currentCount >= dailyLimit) {
        return null;
      }
      claimKind = "coach_message";
    }

    if (opts?.openingBrief) {
      // lockUser above serializes this user's sends, so the empty check holds.
      const [existing] = await tx
        .select({ id: chatMessages.id })
        .from(chatMessages)
        .where(eq(chatMessages.conversationId, conversationId))
        .limit(1);
      if (!existing) {
        await tx.insert(chatMessages).values({
          conversationId,
          role: "assistant",
          content: opts.openingBrief.content,
          metadata: opts.openingBrief.metadata,
          // Both rows would get the transaction's start time; a sort on
          // createdAt alone (the data export) must still put the brief first.
          createdAt: sql`CURRENT_TIMESTAMP - interval '1 millisecond'`,
        });
        await tx
          .update(pendingReminders)
          .set({ acknowledgedAt: new Date() })
          .where(
            and(
              eq(pendingReminders.userId, userId),
              isNull(pendingReminders.acknowledgedAt),
            ),
          );
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

    await recordMessageClaim(tx, userId, message.id, claimKind);

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
