import {
  cookbookCoverCandidates,
  cookbookCoverGenerationLog,
} from "@shared/schema";
import { db } from "../db";
import { and, count, eq, gt, gte, lte, notInArray, sql } from "drizzle-orm";
import { deleteImage } from "../lib/image-store";
import { logger, toError } from "../lib/logger";

// ============================================================================
// COOKBOOK COVER STUDIO — candidates waiting to be picked
// ============================================================================

/** How long a generated set can be picked from. */
export const COVER_CANDIDATE_TTL_MS = 2 * 60 * 60 * 1000;

const PURGE_INTERVAL_MS = 60 * 60 * 1000; // hourly

export interface StoredCoverCandidateSet {
  candidates: { id: string; imageUrl: string }[];
  expiresAt: Date;
  /** The user's previous set, now deleted — the caller removes the objects. */
  replacedUrls: string[];
}

/**
 * Store a new set for `userId`, log it toward the daily cap, and delete the
 * user's previous set — one transaction under a per-user advisory lock, so two
 * concurrent sets serialise and only the later one is left live.
 *
 * The old rows are deleted by "not in this set", never by timestamp:
 * `now()` is the transaction's start, so it can't tell old from new.
 */
export async function storeCoverCandidateSet(
  userId: string,
  imageUrls: string[],
): Promise<StoredCoverCandidateSet> {
  const expiresAt = new Date(Date.now() + COVER_CANDIDATE_TTL_MS);
  return await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${"cover-candidates:" + userId}, 0))`,
    );
    const inserted = await tx
      .insert(cookbookCoverCandidates)
      .values(imageUrls.map((imageUrl) => ({ userId, imageUrl, expiresAt })))
      .returning({
        id: cookbookCoverCandidates.id,
        imageUrl: cookbookCoverCandidates.imageUrl,
      });
    await tx.insert(cookbookCoverGenerationLog).values({ userId });
    const replaced = await tx
      .delete(cookbookCoverCandidates)
      .where(
        and(
          eq(cookbookCoverCandidates.userId, userId),
          notInArray(
            cookbookCoverCandidates.id,
            inserted.map((r) => r.id),
          ),
        ),
      )
      .returning({ imageUrl: cookbookCoverCandidates.imageUrl });
    return {
      candidates: inserted,
      expiresAt,
      replacedUrls: replaced.map((r) => r.imageUrl),
    };
  });
}

/**
 * Take the user's live candidate `id` and return its image URL, or null when
 * it is missing, expired, or another user's — the same null for all three.
 * One DELETE, so a concurrent purge, replace or second claim can't also win.
 */
export async function claimCoverCandidate(
  id: string,
  userId: string,
): Promise<string | null> {
  const [row] = await db
    .delete(cookbookCoverCandidates)
    .where(
      and(
        eq(cookbookCoverCandidates.id, id),
        eq(cookbookCoverCandidates.userId, userId),
        gt(cookbookCoverCandidates.expiresAt, new Date()),
      ),
    )
    .returning({ imageUrl: cookbookCoverCandidates.imageUrl });
  return row?.imageUrl ?? null;
}

/** Sets the user has stored since `since` — the daily cap's count. */
export async function countCoverSetsSince(
  userId: string,
  since: Date,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(cookbookCoverGenerationLog)
    .where(
      and(
        eq(cookbookCoverGenerationLog.userId, userId),
        gte(cookbookCoverGenerationLog.createdAt, since),
      ),
    );
  return Number(row?.n ?? 0);
}

/**
 * Delete expired candidates, then the stored objects of exactly those rows.
 * Rows first: a claimed cover's row is already gone, so its object is never
 * touched. One failed object delete is logged and the rest still go.
 * Returns the purged URLs.
 */
export async function purgeExpiredCoverCandidates(): Promise<string[]> {
  const rows = await db
    .delete(cookbookCoverCandidates)
    .where(lte(cookbookCoverCandidates.expiresAt, new Date()))
    .returning({ imageUrl: cookbookCoverCandidates.imageUrl });
  const urls = rows.map((r) => r.imageUrl);
  for (const url of urls) {
    try {
      await deleteImage(url, "cookbook");
    } catch (err) {
      logger.warn(
        { err: toError(err), url },
        "cover candidate purge: object delete failed — object may be orphaned",
      );
    }
  }
  if (urls.length > 0) {
    logger.debug({ purged: urls.length }, "cover candidate purge");
  }
  return urls;
}

/** Start the hourly purge. Returns the interval so shutdown can clear it. */
export function startCoverCandidatePurgeJob(): ReturnType<typeof setInterval> {
  return setInterval(() => {
    purgeExpiredCoverCandidates().catch((err) => {
      logger.error({ err: toError(err) }, "cover candidate purge error");
    });
  }, PURGE_INTERVAL_MS);
}
