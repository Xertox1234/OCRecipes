import {
  type Allergy,
  type FamilyProfile,
  familyProfiles,
  mealPlanItems,
} from "@shared/schema";
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
  executor: Pick<typeof db, "select"> = db,
): Promise<FamilyProfile[]> {
  return executor
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
  return db.transaction((tx) => createFamilyProfileIn(tx, userId, input));
}

/** Anything that can take the lock, count and insert: a transaction. */
type CreateExecutor = Pick<typeof db, "execute" | "select" | "insert">;

/**
 * createFamilyProfile inside the caller's transaction (the Coach's family
 * card saves with its card row). The advisory lock is held to the end of
 * that transaction, so the cap holds the same way.
 */
export async function createFamilyProfileIn(
  tx: CreateExecutor,
  userId: string,
  input: FamilyProfileInput,
): Promise<FamilyProfile | "limit"> {
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
  executor: Pick<typeof db, "delete"> = db,
): Promise<boolean> {
  const result = await executor
    .delete(familyProfiles)
    .where(and(eq(familyProfiles.id, id), eq(familyProfiles.userId, userId)))
    .returning({ id: familyProfiles.id });
  return result.length > 0;
}

/**
 * Undo for the Coach's family card: deletes the profile only while it is
 * exactly what the card saved (name, allergies, no note) and has no planned
 * meals of its own, which the delete would take with it. Otherwise it is
 * left alone: "kept". Runs on the card's transaction; the row is locked.
 */
export async function deleteFamilyProfileIfUnchanged(
  executor: Pick<typeof db, "select" | "delete">,
  userId: string,
  added: { id: number; name: string; allergies: Allergy[] },
): Promise<"removed" | "kept" | "gone"> {
  const [row] = await executor
    .select()
    .from(familyProfiles)
    .where(
      and(eq(familyProfiles.id, added.id), eq(familyProfiles.userId, userId)),
    )
    .for("update");
  if (!row) return "gone";
  const unchanged =
    row.name === added.name &&
    row.note === null &&
    JSON.stringify(row.allergies) === JSON.stringify(added.allergies);
  if (!unchanged) return "kept";
  const [meal] = await executor
    .select({ id: mealPlanItems.id })
    .from(mealPlanItems)
    .where(
      and(
        eq(mealPlanItems.familyProfileId, added.id),
        eq(mealPlanItems.userId, userId),
      ),
    )
    .limit(1);
  if (meal) return "kept";
  await executor
    .delete(familyProfiles)
    .where(
      and(eq(familyProfiles.id, added.id), eq(familyProfiles.userId, userId)),
    );
  return "removed";
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
