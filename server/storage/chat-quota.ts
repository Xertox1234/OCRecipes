// server/storage/chat-quota.ts
// Daily recipe-generation quota and recipe-finder claims (spec 2026-09-28 §6).
// Split from chat.ts (over the 500-line storage threshold); chat.ts imports
// lockUser + countRecipeGenerationsToday from here, never the reverse.
import {
  type ChatMessage,
  chatConversations,
  chatMessages,
  recipeFinderClaims,
} from "@shared/schema";
import { db } from "../db";
import { eq, and, gte, lt, sql, inArray } from "drizzle-orm";
import { quotaDayBounds } from "./quota-day";

export type ChatTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Per-user advisory lock serializing every quota-checked chat write.
 * hashtextextended returns a 64-bit bigint, eliminating the ~65k-user
 * birthday-collision risk of the 32-bit hashtext() form (L31).
 */
export const lockUser = (tx: ChatTx, userId: string) =>
  tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`);

/**
 * Today's recipe generations — the ONE count the legacy recipe/remix path and
 * the recipe finder's Generate step both enforce (spec §6):
 *   A: user rows in recipe conversations that are not finder-step rows
 *   B: finder Generate claims today (recipe or coach) — recipe_finder_claims,
 *      so deleting the row or its conversation never hands the slot back
 *   C: distinct remix conversations with a user row, created today
 * Legs A and C count rows, and are never below the message claims recorded
 * today (`recordMessageClaim`), so a delete does not lower them. Day bounds
 * are the user's stored-timezone day (`quotaDayBounds`) — the paths share one bucket.
 */
export async function countRecipeGenerationsToday(
  tx: ChatTx,
  userId: string,
): Promise<number> {
  const { startOfDay, endOfDay } = await quotaDayBounds(tx, userId);
  const today = and(
    eq(chatConversations.userId, userId),
    eq(chatMessages.role, "user"),
    gte(chatMessages.createdAt, startOfDay),
    lt(chatMessages.createdAt, endOfDay),
  );
  // One query at a time: a transaction has one connection, and pg@9 removes
  // the queue that today lets Promise.all'd queries share it.
  const legacyRecipeRows = await tx
    .select({ count: sql<number>`count(*)` })
    .from(chatMessages)
    .innerJoin(
      chatConversations,
      eq(chatMessages.conversationId, chatConversations.id),
    )
    .where(
      and(
        today,
        eq(chatConversations.type, "recipe"),
        sql`coalesce(${chatMessages.metadata}->>'finderInput', 'false') <> 'true'`,
      ),
    );
  const claimedGenerations = await countClaimsToday(
    tx,
    userId,
    "recipe_generation",
  );
  const remixConvCount = await tx
    .select({ count: sql<number>`count(DISTINCT ${chatConversations.id})` })
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
  // Each of the two row-based legs is also never below the claims its
  // messages recorded today, so deleting a message or its conversation does
  // not hand the slot back (audit 2026-11-24, H4). The remix claim is dated
  // by its first message, so a conversation created on an earlier day counts
  // on the day it is used (M48).
  const recipeMessages = Math.max(
    Number(legacyRecipeRows[0]?.count ?? 0),
    await countClaimsToday(tx, userId, "recipe_message"),
  );
  const remixGenerations = Math.max(
    Number(remixConvCount[0]?.count ?? 0),
    await countClaimsToday(tx, userId, "remix_generation"),
  );
  return recipeMessages + claimedGenerations + remixGenerations;
}

export type FinderUserMessageResult =
  | { status: "created"; message: ChatMessage }
  | { status: "duplicate" }
  | { status: "limit_reached" };

/**
 * A recipe-finder user row (typed request or button tap). Never counted as a
 * recipe generation (`finderInput`). A button tap's flowId is recorded so a
 * repeated tap on the same flow is a duplicate — checked under the same
 * per-user advisory lock every chat write takes, so concurrent double taps
 * serialize. Coach taps also enforce the Coach Pro message limit.
 */
export async function createFinderUserMessage(
  conversationId: number,
  userId: string,
  content: string,
  opts: {
    action?: { flowId: string; type: string };
    coachDailyLimit?: number;
  } = {},
): Promise<FinderUserMessageResult> {
  return db.transaction(async (tx) => {
    await lockUser(tx, userId);
    const owned = await tx
      .select({ id: chatConversations.id })
      .from(chatConversations)
      .where(
        and(
          eq(chatConversations.id, conversationId),
          eq(chatConversations.userId, userId),
        ),
      )
      .limit(1);
    if (owned.length === 0) throw new Error("Conversation not found");

    if (opts.action) {
      const dup = await tx
        .select({ id: chatMessages.id })
        .from(chatMessages)
        .where(
          and(
            eq(chatMessages.conversationId, conversationId),
            eq(chatMessages.role, "user"),
            sql`${chatMessages.metadata}->'finderAction'->>'flowId' = ${opts.action.flowId}`,
          ),
        )
        .limit(1);
      if (dup.length > 0) return { status: "duplicate" as const };
    }

    if (opts.coachDailyLimit !== undefined) {
      const { startOfDay, endOfDay } = await quotaDayBounds(tx, userId);
      const [row] = await tx
        .select({ count: sql<number>`count(*)` })
        .from(chatMessages)
        .innerJoin(
          chatConversations,
          eq(chatMessages.conversationId, chatConversations.id),
        )
        .where(
          and(
            eq(chatConversations.userId, userId),
            eq(chatConversations.type, "coach"),
            eq(chatMessages.role, "user"),
            gte(chatMessages.createdAt, startOfDay),
            lt(chatMessages.createdAt, endOfDay),
          ),
        );
      // Never below today's typed-message claims: a deleted message keeps
      // its slot (audit 2026-11-24, H4).
      const used = Math.max(
        Number(row?.count ?? 0),
        await countClaimsToday(tx, userId, "coach_message"),
      );
      if (used >= opts.coachDailyLimit) {
        return { status: "limit_reached" as const };
      }
    }

    const [message] = await tx
      .insert(chatMessages)
      .values({
        conversationId,
        role: "user",
        content,
        metadata: {
          finderInput: true,
          ...(opts.action ? { finderAction: opts.action } : {}),
        },
      })
      .returning();
    await tx
      .update(chatConversations)
      .set({ updatedAt: new Date() })
      .where(eq(chatConversations.id, conversationId));
    return { status: "created" as const, message };
  });
}

/**
 * A claim recorded for a quota-checked user message itself (audit
 * 2026-11-24, H4): the daily limits used to count live rows, so deleting a
 * message or its conversation handed the slot back. `message_id` goes null
 * when the row is deleted and the claim stays.
 */
export type MessageClaimKind =
  | "coach_message"
  | "recipe_message"
  | "remix_generation"
  | "remix_refinement";

const MESSAGE_CLAIM_KINDS: MessageClaimKind[] = [
  "coach_message",
  "recipe_message",
  "remix_generation",
  "remix_refinement",
];

type ClaimKind = "recipe_generation" | "spoonacular_search" | MessageClaimKind;

/**
 * Free refinements per counted remix generation, as a daily bound across
 * conversations: with a limit of 20 generations, 100 refinements a day.
 * Each refinement runs a full generation and a picture, so "free" cannot
 * mean unbounded (M48). The per-conversation-quota design expects 3-5.
 */
export const REMIX_REFINEMENTS_PER_GENERATION = 5;

/** Today's claims of one message kind, inside the caller's locked transaction. */
export const countMessageClaimsToday = (
  tx: ChatTx,
  userId: string,
  kind: MessageClaimKind,
): Promise<number> => countClaimsToday(tx, userId, kind);

/**
 * Records the claim for a user message the caller has just inserted in this
 * transaction (so ownership is already established).
 */
export async function recordMessageClaim(
  tx: ChatTx,
  userId: string,
  messageId: number,
  kind: MessageClaimKind,
): Promise<void> {
  await tx
    .insert(recipeFinderClaims)
    .values({ userId, kind, messageId })
    .onConflictDoNothing({
      target: [recipeFinderClaims.messageId, recipeFinderClaims.kind],
    });
}

/**
 * The disconnect refund: the user's message got no reply at all, so the row
 * goes and its message claim with it, which hands the slot back. A paid
 * claim on the same row (a finder Generate, a Spoonacular search) stays, as
 * it always has (#1151). Returns false when the row is not the user's.
 */
export async function refundUndeliveredMessage(
  messageId: number,
  userId: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await lockUser(tx, userId);
    // The claim first, while it still points at the row: deleting the row
    // sets message_id to null. Scoped to the user and to message claims.
    await tx
      .delete(recipeFinderClaims)
      .where(
        and(
          eq(recipeFinderClaims.userId, userId),
          eq(recipeFinderClaims.messageId, messageId),
          inArray(recipeFinderClaims.kind, MESSAGE_CLAIM_KINDS),
        ),
      );
    const deleted = await tx
      .delete(chatMessages)
      .where(
        and(
          eq(chatMessages.id, messageId),
          inArray(
            chatMessages.conversationId,
            tx
              .select({ id: chatConversations.id })
              .from(chatConversations)
              .where(eq(chatConversations.userId, userId)),
          ),
        ),
      )
      .returning({ id: chatMessages.id });
    if (deleted.length === 0) return false;
    return true;
  });
}

async function countClaimsToday(
  tx: ChatTx,
  userId: string,
  kind: ClaimKind,
): Promise<number> {
  const { startOfDay, endOfDay } = await quotaDayBounds(tx, userId);
  const [row] = await tx
    .select({ count: sql<number>`count(*)` })
    .from(recipeFinderClaims)
    .where(
      and(
        eq(recipeFinderClaims.userId, userId),
        eq(recipeFinderClaims.kind, kind),
        gte(recipeFinderClaims.createdAt, startOfDay),
        lt(recipeFinderClaims.createdAt, endOfDay),
      ),
    );
  return Number(row?.count ?? 0);
}

/**
 * Records a claim on the user's own user row, inside the caller's locked
 * transaction. Returns false if no such row. A repeated claim on the same
 * row and kind is recorded once, as the old metadata marker was.
 */
async function recordClaim(
  tx: ChatTx,
  userId: string,
  messageId: number,
  kind: ClaimKind,
): Promise<boolean> {
  const own = await tx
    .select({ id: chatMessages.id })
    .from(chatMessages)
    .innerJoin(
      chatConversations,
      eq(chatMessages.conversationId, chatConversations.id),
    )
    .where(
      and(
        eq(chatMessages.id, messageId),
        eq(chatMessages.role, "user"),
        eq(chatConversations.userId, userId),
      ),
    )
    .limit(1);
  if (own.length === 0) return false;
  await tx
    .insert(recipeFinderClaims)
    .values({ userId, kind, messageId })
    .onConflictDoNothing({
      target: [recipeFinderClaims.messageId, recipeFinderClaims.kind],
    });
  return true;
}

/**
 * Atomically check the 20/day recipe generation limit and record this
 * Generate against it (lock → count → record, one transaction — the
 * createChatMessageWithLimitCheck precedent). Both chats call this.
 */
export async function claimRecipeGeneration(
  userId: string,
  messageId: number,
  dailyLimit: number,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await lockUser(tx, userId);
    if ((await countRecipeGenerationsToday(tx, userId)) >= dailyLimit) {
      return false;
    }
    return recordClaim(tx, userId, messageId, "recipe_generation");
  });
}

/** D9: DB-backed per-user Spoonacular list-search cap (never in-memory). */
export async function claimSpoonacularSearch(
  userId: string,
  messageId: number,
  dailyCap: number,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await lockUser(tx, userId);
    if (
      (await countClaimsToday(tx, userId, "spoonacular_search")) >= dailyCap
    ) {
      return false;
    }
    return recordClaim(tx, userId, messageId, "spoonacular_search");
  });
}
