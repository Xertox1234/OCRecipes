import type { MeasurementUnit } from "@shared/lib/units";

/**
 * The public shape of the signed-in user (explicit allowlist — never spread a
 * User row: it carries the password hash, reset columns and pendingEmail).
 * Shared by the password routes (auth.ts) and the Google/Apple routes
 * (auth-social.ts); lives in its own module so those two don't import each
 * other.
 */
export function serializeUser(user: {
  id: string;
  username: string;
  email: string;
  emailVerified: boolean;
  displayName: string | null;
  avatarUrl: string | null;
  dailyCalorieGoal: number | null;
  onboardingCompleted: boolean | null;
  subscriptionTier: string | null;
  measurementUnit: MeasurementUnit;
}) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    emailVerified: user.emailVerified,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    dailyCalorieGoal: user.dailyCalorieGoal,
    onboardingCompleted: user.onboardingCompleted,
    subscriptionTier: user.subscriptionTier || "free",
    measurementUnit: user.measurementUnit,
  };
}
