import {
  type UserProfile,
  type InsertUserProfile,
  users,
  userProfiles,
} from "@shared/schema";
import type { ReminderMutes } from "@shared/types/reminders";
import { db } from "../db";
import { eq, sql } from "drizzle-orm";

// User profile storage, split out of users.ts (pure move). users.ts
// re-exports these, so the storage facade and existing imports are unchanged.

export async function getUserProfile(
  userId: string,
): Promise<UserProfile | undefined> {
  const [profile] = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId));
  return profile || undefined;
}

export async function createUserProfile(
  profile: InsertUserProfile,
): Promise<UserProfile> {
  const [newProfile] = await db
    .insert(userProfiles)
    .values(profile)
    .returning();
  return newProfile;
}

/** Whitelist of fields callers may update on a user profile.
 *  `userId` is excluded — it's a foreign key and immutable after creation.
 *  `healthDataConsentAt` is excluded — it's a legally significant timestamp
 *  generated internally; callers signal intent via the `recordConsent` flag. */
type UpdatableProfileFields = Pick<
  InsertUserProfile,
  | "allergies"
  | "healthConditions"
  | "dietType"
  | "foodDislikes"
  | "primaryGoal"
  | "activityLevel"
  | "householdSize"
  | "cuisinePreferences"
  | "cookingSkillLevel"
  | "cookingTimeAvailable"
  | "glp1Mode"
  | "glp1Medication"
  | "glp1StartDate"
  | "reminderMutes"
>;

export async function updateUserProfile(
  userId: string,
  updates: Partial<UpdatableProfileFields>,
  recordConsent = false,
): Promise<UserProfile | undefined> {
  // Append-only consent: SQL `COALESCE(existing, new)` keeps the first
  // non-null `healthDataConsentAt` so a re-stamp request cannot overwrite
  // the original consent record. The timestamp is generated here from
  // `new Date()` rather than accepted as a parameter so callers cannot
  // supply (or accidentally forward) a backdated value.
  //
  // Runtime strip: even though `UpdatableProfileFields` excludes the column
  // at compile time, defensively destructure it out of the spread so a
  // caller that bypasses TS (`as any`, JS scripts, malformed objects)
  // cannot smuggle a `Date` into the SET clause.
  const { healthDataConsentAt: _strip, ...safeUpdates } =
    updates as Partial<UpdatableProfileFields> & {
      healthDataConsentAt?: Date | null;
    };
  void _strip;
  const setClause: Record<string, unknown> = {
    ...safeUpdates,
    updatedAt: new Date(),
  };
  if (recordConsent) {
    setClause.healthDataConsentAt = sql`COALESCE(${userProfiles.healthDataConsentAt}, ${new Date()})`;
  }
  const [profile] = await db
    .update(userProfiles)
    .set(setClause)
    .where(eq(userProfiles.userId, userId))
    .returning();
  return profile || undefined;
}

/**
 * Merges reminder mutes into the user's profile, creating a bare profile row
 * (every other column defaults) when none exists yet — a plain UPDATE would
 * match nothing for a profile-less account and silently drop the change.
 * Returns the stored mutes after the merge.
 */
export async function saveReminderMutes(
  userId: string,
  mutes: Partial<ReminderMutes>,
): Promise<ReminderMutes> {
  const [row] = await db
    .insert(userProfiles)
    .values({ userId, reminderMutes: mutes })
    .onConflictDoUpdate({
      target: userProfiles.userId,
      set: {
        reminderMutes: sql`${userProfiles.reminderMutes} || excluded.reminder_mutes`,
        updatedAt: new Date(),
      },
    })
    .returning({ reminderMutes: userProfiles.reminderMutes });
  return row.reminderMutes;
}

/**
 * Atomically upserts a user profile and marks onboarding as complete.
 * Used by the POST /api/user/dietary-profile onboarding endpoint.
 *
 * `healthDataConsentAt` is omitted from `profileData` because the timestamp
 * is generated internally; callers signal intent via `recordConsent`.
 */
export async function upsertProfileWithOnboarding(
  userId: string,
  profileData: Omit<InsertUserProfile, "userId" | "healthDataConsentAt">,
  recordConsent = false,
): Promise<UserProfile> {
  // Runtime strip: the parameter type excludes `healthDataConsentAt` at
  // compile time, but defensively destructure it out of the spread so a
  // caller that bypasses TS (`as any`, JS scripts, malformed objects)
  // cannot smuggle a `Date` into the upsert.
  const { healthDataConsentAt: _strip, ...safeProfileData } =
    profileData as Omit<InsertUserProfile, "userId" | "healthDataConsentAt"> & {
      healthDataConsentAt?: Date | null;
    };
  void _strip;

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId));

    let result: UserProfile;
    if (existing) {
      // Append-only consent: never overwrite a previously recorded
      // `healthDataConsentAt`. Once consent has been captured, replays of
      // this onboarding endpoint preserve the original timestamp as the
      // legally significant record of agreement. The timestamp is generated
      // here from `new Date()` so callers cannot supply a backdated value.
      const safeData: Omit<InsertUserProfile, "userId"> =
        recordConsent && !existing.healthDataConsentAt
          ? { ...safeProfileData, healthDataConsentAt: new Date() }
          : safeProfileData;
      [result] = await tx
        .update(userProfiles)
        .set({ ...safeData, updatedAt: new Date() })
        .where(eq(userProfiles.userId, userId))
        .returning();
    } else {
      const insertData: Omit<InsertUserProfile, "userId"> = recordConsent
        ? { ...safeProfileData, healthDataConsentAt: new Date() }
        : safeProfileData;
      [result] = await tx
        .insert(userProfiles)
        .values({ ...insertData, userId })
        .returning();
    }

    await tx
      .update(users)
      .set({ onboardingCompleted: true })
      .where(eq(users.id, userId));

    return result;
  });
}
