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
import { eq, and, gte, lt, sql } from "drizzle-orm";
import { getDayBounds } from "./helpers";

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
 * Legs A and C stay row-based, as the legacy limits always were. Day bounds
 * are UTC, as the pre-finder count always was — the paths share one bucket.
 */
export async function countRecipeGenerationsToday(
  tx: ChatTx,
  userId: string,
): Promise<number> {
  const { startOfDay, endOfDay } = getDayBounds(new Date());
  const today = and(
    eq(chatConversations.userId, userId),
    eq(chatMessages.role, "user"),
    gte(chatMessages.createdAt, startOfDay),
    lt(chatMessages.createdAt, endOfDay),
  );
  const [legacyRecipeRows, claimedGenerations, remixConvCount] =
    await Promise.all([
      tx
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
        ),
      countClaimsToday(tx, userId, "recipe_generation"),
      tx
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
        ),
    ]);
  return (
    Number(legacyRecipeRows[0]?.count ?? 0) +
    claimedGenerations +
    Number(remixConvCount[0]?.count ?? 0)
  );
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
      const { startOfDay, endOfDay } = getDayBounds(new Date());
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
      if (Number(row?.count ?? 0) >= opts.coachDailyLimit) {
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

type ClaimKind = "recipe_generation" | "spoonacular_search";

async function countClaimsToday(
  tx: ChatTx,
  userId: string,
  kind: ClaimKind,
): Promise<number> {
  const { startOfDay, endOfDay } = getDayBounds(new Date());
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
