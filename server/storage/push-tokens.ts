import { pushTokens, type PushToken } from "@shared/schema";
import { db } from "../db";
import { eq, and, inArray, ne, sql } from "drizzle-orm";

/**
 * Upsert a push token for a user+platform pair.
 * If the user already has a token for this platform it is replaced,
 * implementing automatic token rotation.
 *
 * An Expo push token belongs to the app install, not the user, so the same
 * token held by ANY other user is removed first: when B signs in on A's old
 * phone, A's reminders (journal text) must stop reaching that device.
 */
export async function upsertPushToken(
  userId: string,
  token: string,
  platform: "ios" | "android",
): Promise<PushToken> {
  return db.transaction(async (tx) => {
    await tx
      .delete(pushTokens)
      .where(and(eq(pushTokens.token, token), ne(pushTokens.userId, userId)));
    const [row] = await tx
      .insert(pushTokens)
      .values({ userId, token, platform })
      .onConflictDoUpdate({
        target: [pushTokens.userId, pushTokens.platform],
        set: {
          token,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        },
      })
      .returning();
    return row;
  });
}

/** Return all push tokens for a user (typically one per platform). */
export async function getPushTokensForUser(
  userId: string,
): Promise<PushToken[]> {
  return db.select().from(pushTokens).where(eq(pushTokens.userId, userId));
}

/** Return all tokens for a list of user IDs. */
export async function getPushTokensForUsers(
  userIds: string[],
): Promise<PushToken[]> {
  if (userIds.length === 0) return [];
  return db
    .select()
    .from(pushTokens)
    .where(inArray(pushTokens.userId, userIds));
}

/** Remove a specific token (e.g. on receipt of a delivery failure). */
export async function deletePushToken(
  userId: string,
  token: string,
): Promise<void> {
  await db
    .delete(pushTokens)
    .where(and(eq(pushTokens.userId, userId), eq(pushTokens.token, token)));
}
