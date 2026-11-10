import { users } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import {
  AI_SHARING_VERSION,
  type AiSharingEvent,
  type AiSharingStatus,
} from "@shared/lib/ai-sharing";
import { db } from "../db";

/**
 * AI-sharing permission record (privacy audit H3). The live permission is
 * `aiSharingAllowedAt`; `aiSharingHistory` is only ever appended to, so what
 * the user answered, and when, survives a later change.
 */

function historyEntry(event: AiSharingEvent) {
  return sql`${JSON.stringify([event])}::jsonb`;
}

function toStatus(row: {
  aiSharingAllowedAt: Date | null;
  aiSharingHistory: AiSharingEvent[];
}): AiSharingStatus {
  return {
    allowed: row.aiSharingAllowedAt !== null,
    answered: row.aiSharingHistory.length > 0,
  };
}

const STATUS_COLUMNS = {
  aiSharingAllowedAt: users.aiSharingAllowedAt,
  aiSharingHistory: users.aiSharingHistory,
};

export async function getAiSharingStatus(
  userId: string,
): Promise<AiSharingStatus | undefined> {
  const [row] = await db
    .select(STATUS_COLUMNS)
    .from(users)
    .where(eq(users.id, userId));
  return row ? toStatus(row) : undefined;
}

/** True while the user allows AI sharing. An unknown user is not allowed. */
export async function isAiSharingAllowed(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ aiSharingAllowedAt: users.aiSharingAllowedAt })
    .from(users)
    .where(eq(users.id, userId));
  return row?.aiSharingAllowedAt != null;
}

/**
 * Record the user's answer. A repeated "yes" keeps the first record; a "no"
 * is logged as "withdrawn" after a yes and "declined" otherwise. Each CASE
 * reads the row as it was before this update, so the write is one statement.
 */
export async function setAiSharing(
  userId: string,
  allowed: boolean,
): Promise<AiSharingStatus | undefined> {
  const now = new Date();
  const at = now.toISOString();
  const wasAllowed = sql`${users.aiSharingAllowedAt} IS NOT NULL`;
  const append = (event: AiSharingEvent) =>
    sql`${users.aiSharingHistory} || ${historyEntry(event)}`;

  const set = allowed
    ? {
        aiSharingAllowedAt: sql`COALESCE(${users.aiSharingAllowedAt}, ${now})`,
        aiSharingVersion: sql`CASE WHEN ${wasAllowed} THEN ${users.aiSharingVersion} ELSE ${AI_SHARING_VERSION} END`,
        aiSharingHistory: sql`CASE WHEN ${wasAllowed} THEN ${users.aiSharingHistory} ELSE ${append({ event: "granted", at, version: AI_SHARING_VERSION })} END`,
      }
    : {
        aiSharingAllowedAt: null,
        aiSharingVersion: null,
        aiSharingHistory: sql`CASE WHEN ${wasAllowed} THEN ${append({ event: "withdrawn", at })} ELSE ${append({ event: "declined", at })} END`,
      };

  const [row] = await db
    .update(users)
    .set(set)
    .where(eq(users.id, userId))
    .returning(STATUS_COLUMNS);
  return row ? toStatus(row) : undefined;
}
