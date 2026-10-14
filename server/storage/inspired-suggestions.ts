// server/storage/inspired-suggestions.ts
import { and, count, eq, gte, inArray, isNull, lt, lte, or } from "drizzle-orm";
import { db } from "../db";
import {
  inspiredSuggestions,
  type InspiredSuggestionRow,
} from "@shared/schema";
import {
  MAKING_STALE_MS,
  type SuggestionDraft,
} from "@shared/schemas/inspired-recipes";

export async function createInspiredSuggestions(
  userId: string,
  drafts: SuggestionDraft[],
  expiresAt: Date,
): Promise<InspiredSuggestionRow[]> {
  if (drafts.length === 0) return [];
  return db
    .insert(inspiredSuggestions)
    .values(drafts.map((d) => ({ ...d, userId, expiresAt })))
    .returning();
}

/** Cards created for this user since `since` (rolling daily cap). */
export async function countInspiredSuggestionsSince(
  userId: string,
  since: Date,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(inspiredSuggestions)
    .where(
      and(
        eq(inspiredSuggestions.userId, userId),
        gte(inspiredSuggestions.createdAt, since),
      ),
    );
  return row?.n ?? 0;
}

export async function getInspiredSuggestions(
  userId: string,
  ids: number[],
): Promise<InspiredSuggestionRow[]> {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(inspiredSuggestions)
    .where(
      and(
        eq(inspiredSuggestions.userId, userId),
        inArray(inspiredSuggestions.id, ids),
      ),
    );
}

export async function getInspiredSuggestion(
  userId: string,
  id: number,
): Promise<InspiredSuggestionRow | undefined> {
  const [row] = await getInspiredSuggestions(userId, [id]);
  return row;
}

/**
 * Takes the single-make lock. Returns the exact `makingStartedAt` written (the
 * holder's token for `abandonMakingSuggestion`), or null if the lock was not
 * taken (not the owner, already made, or held and not yet stale).
 */
export async function startMakingSuggestion(
  userId: string,
  id: number,
  staleAfterMs: number,
): Promise<Date | null> {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - staleAfterMs);
  const updated = await db
    .update(inspiredSuggestions)
    .set({ makingStartedAt: now })
    .where(
      and(
        eq(inspiredSuggestions.id, id),
        eq(inspiredSuggestions.userId, userId),
        isNull(inspiredSuggestions.madeRecipeId),
        or(
          isNull(inspiredSuggestions.makingStartedAt),
          lte(inspiredSuggestions.makingStartedAt, staleBefore),
        ),
      ),
    )
    .returning({ makingStartedAt: inspiredSuggestions.makingStartedAt });
  return updated[0]?.makingStartedAt ?? null;
}

// prettier-ignore
export async function abandonMakingSuggestion(id: number, startedAt: Date): Promise<void> { // idor-safe: callers must pre-verify ownership via startMakingSuggestion(userId, id); startedAt is that call's lock token
  await db
    .update(inspiredSuggestions)
    .set({ makingStartedAt: null })
    .where(
      and(
        eq(inspiredSuggestions.id, id),
        eq(inspiredSuggestions.makingStartedAt, startedAt),
        isNull(inspiredSuggestions.madeRecipeId),
      ),
    );
}

export async function claimInspiredSuggestionMade(
  userId: string,
  id: number,
  recipeId: number,
): Promise<boolean> {
  const updated = await db
    .update(inspiredSuggestions)
    .set({ madeRecipeId: recipeId })
    .where(
      and(
        eq(inspiredSuggestions.id, id),
        eq(inspiredSuggestions.userId, userId),
        isNull(inspiredSuggestions.madeRecipeId),
      ),
    )
    .returning({ id: inspiredSuggestions.id });
  return updated.length > 0;
}

/** Not mid-make: no lock, or a lock old enough to be a crashed request. */
function noLiveMakeLock(now: Date) {
  return or(
    isNull(inspiredSuggestions.makingStartedAt),
    lte(
      inspiredSuggestions.makingStartedAt,
      new Date(now.getTime() - MAKING_STALE_MS),
    ),
  );
}

export async function listExpiredUnmadeSuggestions(
  now: Date,
  limit: number,
): Promise<InspiredSuggestionRow[]> {
  return db
    .select()
    .from(inspiredSuggestions)
    .where(
      and(
        lt(inspiredSuggestions.expiresAt, now),
        isNull(inspiredSuggestions.madeRecipeId),
        noLiveMakeLock(now),
      ),
    )
    .limit(limit);
}

export async function deleteInspiredSuggestions(
  ids: number[],
): Promise<{ id: number; imageUrl: string | null }[]> {
  if (ids.length === 0) return [];
  const deleted = await db
    .delete(inspiredSuggestions)
    .where(
      and(
        inArray(inspiredSuggestions.id, ids),
        isNull(inspiredSuggestions.madeRecipeId),
        noLiveMakeLock(new Date()),
      ),
    )
    .returning({
      id: inspiredSuggestions.id,
      imageUrl: inspiredSuggestions.imageUrl,
    });
  return deleted;
}
