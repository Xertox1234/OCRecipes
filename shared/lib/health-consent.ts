/**
 * Health-data consent rule (owner ruling 2026-11-10, privacy audit H2):
 * no consent, no health data. The server refuses to save a health field for a
 * user who has not agreed to the health-data consent, and the client asks for
 * the consent before it shows a health question.
 *
 * Health fields are the ones the consent screen names: allergies, health
 * conditions and medications, diet type, body metrics and activity, and the
 * nutrition goal. Taste and cooking preferences (dislikes, cuisines,
 * household, skill, time) are not health data and stay ungated.
 *
 * Diet type joined the list by owner ruling 2026-11-10: a diet can point at a
 * health condition (keto, low FODMAP) or a religion (halal, kosher), so every
 * choice is gated, "omnivore" included.
 */

/**
 * The privacy-policy version a consent is recorded against — the policy's
 * effective date. Bump it when the policy's health-data wording changes.
 *
 * Not bumped for the 2026-11-24 notes wording (pages now dated November 24):
 * the owner chose the date only, so nobody is asked to agree again.
 */
export const HEALTH_CONSENT_VERSION = "2026-11-10";

/** `user_profiles` columns that hold health data. */
export const PROFILE_HEALTH_FIELDS = [
  "allergies",
  "healthConditions",
  "dietType",
  "primaryGoal",
  "activityLevel",
  "glp1Mode",
  "glp1Medication",
  "glp1StartDate",
] as const;

export type ProfileHealthField = (typeof PROFILE_HEALTH_FIELDS)[number];

/** `users` columns that hold health data (body metrics). */
export const USER_HEALTH_FIELDS = [
  "weight",
  "height",
  "age",
  "gender",
  "goalWeight",
] as const;

export type UserHealthField = (typeof USER_HEALTH_FIELDS)[number];

/**
 * One entry in the append-only consent history on the profile: the record of
 * what the user agreed to, and when, that survives a later withdrawal.
 */
export interface HealthConsentEvent {
  event: "granted" | "withdrawn";
  /** ISO time, stamped by the server. */
  at: string;
  /** The policy version in force; set on "granted". */
  version?: string;
}

function carriesValue(value: unknown): boolean {
  if (value === null || value === undefined || value === false) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/**
 * True when the input would store at least one health value. Empty arrays,
 * null, false and blank strings store nothing, so clearing a field (or the
 * all-empty onboarding skip payload) never needs consent.
 */
export function hasHealthData(input: Record<string, unknown>): boolean {
  return PROFILE_HEALTH_FIELDS.some((field) => carriesValue(input[field]));
}

/**
 * Coach's saved notes are paused while no health-data consent is on record
 * (owner rulings 2026-11-24, coach chat audit M52): Coach neither reads the
 * notes nor writes new ones, and commitment reminders stop, until the consent
 * is given. The notes can hold health statements taken from chat. The user
 * can still see and delete them.
 *
 * This covers a user who withdrew the consent and one who never gave it
 * ("Not now" at setup, or no profile yet): the owner's second answer that day
 * was to pause both.
 */
export function coachNotesPaused(
  profile: { healthDataConsentAt?: Date | string | null } | null | undefined,
): boolean {
  return profile?.healthDataConsentAt == null;
}
