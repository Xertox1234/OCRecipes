import { type FamilyProfile, familyProfiles } from "@shared/schema";
import {
  MAX_FAMILY_PROFILES,
  type FamilyProfileInput,
} from "@shared/types/family";
import { db } from "../db";
import { eq, and, sql } from "drizzle-orm";

// ============================================================================
// FAMILY PROFILES
// ============================================================================

/** Anything that can run an UPDATE: the db itself or a transaction on it. */
type DbExecutor = Pick<typeof db, "update">;

/** Profiles in the order the user created them. */
export async function getFamilyProfiles(
  userId: string,
): Promise<FamilyProfile[]> {
  return db
    .select()
    .from(familyProfiles)
    .where(eq(familyProfiles.userId, userId))
    .orderBy(familyProfiles.sortOrder, familyProfiles.id);
}

export async function getFamilyProfile(
  id: number,
  userId: string,
): Promise<FamilyProfile | undefined> {
  const [row] = await db
    .select()
    .from(familyProfiles)
    .where(and(eq(familyProfiles.id, id), eq(familyProfiles.userId, userId)));
  return row || undefined;
}

export async function countFamilyProfiles(userId: string): Promise<number> {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(familyProfiles)
    .where(eq(familyProfiles.userId, userId));
  return result?.count ?? 0;
}

/**
 * Create a profile under the per-user cap. The advisory lock is taken first and
 * the count read under it, so two concurrent creates cannot both pass at 7.
 * Returns "limit" when the user already has `MAX_FAMILY_PROFILES`.
 */
export async function createFamilyProfile(
  userId: string,
  input: FamilyProfileInput,
): Promise<FamilyProfile | "limit"> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${"family-profiles:" + userId}, 0))`,
    );
    const [stats] = await tx
      .select({
        count: sql<number>`count(*)::int`,
        maxOrder: sql<number>`coalesce(max(${familyProfiles.sortOrder}), -1)::int`,
      })
      .from(familyProfiles)
      .where(eq(familyProfiles.userId, userId));
    if ((stats?.count ?? 0) >= MAX_FAMILY_PROFILES) return "limit" as const;

    const [created] = await tx
      .insert(familyProfiles)
      .values({
        userId,
        name: input.name,
        allergies: input.allergies,
        note: input.note,
        sortOrder: (stats?.maxOrder ?? -1) + 1,
      })
      .returning();
    return created;
  });
}

export async function updateFamilyProfile(
  id: number,
  userId: string,
  input: FamilyProfileInput,
): Promise<FamilyProfile | undefined> {
  const [row] = await db
    .update(familyProfiles)
    .set({ name: input.name, allergies: input.allergies, note: input.note })
    .where(and(eq(familyProfiles.id, id), eq(familyProfiles.userId, userId)))
    .returning();
  return row || undefined;
}

/** Delete a profile; its own meals go with it (foreign key cascade), shared meals stay. */
export async function deleteFamilyProfile(
  id: number,
  userId: string,
): Promise<boolean> {
  const result = await db
    .delete(familyProfiles)
    .where(and(eq(familyProfiles.id, id), eq(familyProfiles.userId, userId)))
    .returning({ id: familyProfiles.id });
  return result.length > 0;
}

/**
 * Empty every profile's allergies and note, keeping names. Called from the
 * health-consent withdrawal transaction, so it runs on the caller's executor.
 */
export async function clearFamilyHealthData(
  userId: string,
  executor: DbExecutor = db,
): Promise<void> {
  await executor
    .update(familyProfiles)
    .set({ allergies: [], note: null })
    .where(eq(familyProfiles.userId, userId));
}
