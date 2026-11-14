import {
  type UserProfile,
  type InsertUserProfile,
  users,
  userProfiles,
} from "@shared/schema";
import type { ReminderMutes } from "@shared/types/reminders";
import { db } from "../db";
import { eq, sql } from "drizzle-orm";
import { coachResponseCache, mealSuggestionCache } from "@shared/schema";
import {
  HEALTH_CONSENT_VERSION,
  type HealthConsentEvent,
  type ProfileHealthField,
  type UserHealthField,
} from "@shared/lib/health-consent";

/** A one-entry jsonb array to append to `health_data_consent_history`. */
function historyEntry(event: HealthConsentEvent) {
  return sql`${JSON.stringify([event])}::jsonb`;
}

function grantedEvent(at: Date): HealthConsentEvent {
  return {
    event: "granted",
    at: at.toISOString(),
    version: HEALTH_CONSENT_VERSION,
  };
}

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
    const now = new Date();
    // Every right-hand side reads the row as it was before this UPDATE, so
    // the version and the history entry are written only when the timestamp
    // is: a consent already on record keeps its own version and adds nothing.
    setClause.healthDataConsentAt = sql`COALESCE(${userProfiles.healthDataConsentAt}, ${now})`;
    setClause.healthDataConsentVersion = sql`CASE WHEN ${userProfiles.healthDataConsentAt} IS NULL THEN ${HEALTH_CONSENT_VERSION} ELSE ${userProfiles.healthDataConsentVersion} END`;
    setClause.healthDataConsentHistory = sql`CASE WHEN ${userProfiles.healthDataConsentAt} IS NULL THEN ${userProfiles.healthDataConsentHistory} || ${historyEntry(grantedEvent(now))} ELSE ${userProfiles.healthDataConsentHistory} END`;
  }
  const [profile] = await db
    .update(userProfiles)
    .set(setClause)
    .where(eq(userProfiles.userId, userId))
    .returning();
  return profile || undefined;
}

/**
 * What a withdrawal writes into each health field. Typed against the shared
 * field lists (`shared/lib/health-consent.ts`), so a field added there fails
 * to compile here until it is cleared too.
 */
const CLEARED_PROFILE_HEALTH = {
  allergies: [],
  healthConditions: [],
  dietType: null,
  primaryGoal: null,
  activityLevel: null,
  glp1Mode: false,
  glp1Medication: null,
  glp1StartDate: null,
} satisfies Record<ProfileHealthField, unknown>;

const CLEARED_USER_HEALTH = {
  weight: null,
  height: null,
  age: null,
  gender: null,
  goalWeight: null,
} satisfies Record<UserHealthField, null>;

/**
 * Withdraws the health-data consent, in one transaction: clears every health
 * field on the profile and the body metrics on the user row, deletes the
 * cached AI answers that were built from them, and replaces the live consent
 * with a withdrawal time. Taste and cooking preferences and the calorie
 * targets are not health data and stay. Returns the cleared profile, or
 * undefined when the user has no profile.
 *
 * This is the only path that clears `healthDataConsentAt` (a later consent is
 * stamped afresh). The record of what was agreed to survives in
 * `healthDataConsentHistory`, which is only ever appended to.
 */
export async function withdrawHealthConsent(
  userId: string,
): Promise<UserProfile | undefined> {
  return db.transaction(async (tx) => {
    const now = new Date();
    const [profile] = await tx
      .update(userProfiles)
      .set({
        ...CLEARED_PROFILE_HEALTH,
        // The inferred mood signal is derived from what the user tells Coach.
        moodScore: 0,
        moodUpdatedAt: null,
        healthDataConsentAt: null,
        healthDataConsentVersion: null,
        healthDataConsentWithdrawnAt: now,
        healthDataConsentHistory: sql`${userProfiles.healthDataConsentHistory} || ${historyEntry({ event: "withdrawn", at: now.toISOString() })}`,
        updatedAt: now,
      })
      .where(eq(userProfiles.userId, userId))
      .returning();
    if (!profile) return undefined;

    await tx.update(users).set(CLEARED_USER_HEALTH).where(eq(users.id, userId));

    // Cached Coach answers and meal ideas were built from the allergies,
    // diet type, goals and body metrics just removed.
    await tx
      .delete(coachResponseCache)
      .where(eq(coachResponseCache.userId, userId));
    await tx
      .delete(mealSuggestionCache)
      .where(eq(mealSuggestionCache.userId, userId));

    return profile;
  });
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
      const now = new Date();
      const stampConsent = recordConsent && !existing.healthDataConsentAt;
      [result] = await tx
        .update(userProfiles)
        .set({
          ...safeProfileData,
          ...(stampConsent && {
            healthDataConsentAt: now,
            healthDataConsentVersion: HEALTH_CONSENT_VERSION,
            healthDataConsentHistory: sql`${userProfiles.healthDataConsentHistory} || ${historyEntry(grantedEvent(now))}`,
          }),
          updatedAt: now,
        })
        .where(eq(userProfiles.userId, userId))
        .returning();
    } else {
      const now = new Date();
      const insertData: Omit<InsertUserProfile, "userId"> = recordConsent
        ? {
            ...safeProfileData,
            healthDataConsentAt: now,
            healthDataConsentVersion: HEALTH_CONSENT_VERSION,
            healthDataConsentHistory: [grantedEvent(now)],
          }
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
