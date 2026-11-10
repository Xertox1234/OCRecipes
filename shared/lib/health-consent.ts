/**
 * Health-data consent rule (owner ruling 2026-11-10, privacy audit H2):
 * no consent, no health data. The server refuses to save a health field for a
 * user who has not agreed to the health-data consent, and the client asks for
 * the consent before it shows a health question.
 *
 * Health fields are the ones the consent screen names: allergies, health
 * conditions and medications, body metrics and activity, and the nutrition
 * goal. Taste and cooking preferences (diet type, dislikes, cuisines,
 * household, skill, time) are not health data and stay ungated.
 */

/**
 * The privacy-policy version a consent is recorded against — the policy's
 * effective date. Bump it when the policy's health-data wording changes.
 */
export const HEALTH_CONSENT_VERSION = "2026-11-03";

/** `user_profiles` columns that hold health data. */
export const PROFILE_HEALTH_FIELDS = [
  "allergies",
  "healthConditions",
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
