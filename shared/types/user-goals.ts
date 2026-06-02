import { z } from "zod";

/**
 * Canonical user-goal enums shared between client and server.
 *
 * These were previously declared in three places — `server/services/goal-calculator.ts`
 * (canonical), a character-identical copy in `client/screens/GoalSetupScreen.tsx`, and an
 * implicit degraded `string | null` in `useDietaryProfileForm`. This is the single source
 * of truth: the union types and the Zod schemas both derive from the same `as const` arrays,
 * so server validation and client typing cannot drift.
 */

export const activityLevels = [
  "sedentary",
  "light",
  "moderate",
  "active",
  "athlete",
] as const;
export type ActivityLevel = (typeof activityLevels)[number];
export const activityLevelSchema = z.enum(activityLevels);

export const primaryGoals = [
  "lose_weight",
  "gain_muscle",
  "maintain",
  "eat_healthier",
  "manage_condition",
] as const;
export type PrimaryGoal = (typeof primaryGoals)[number];
export const primaryGoalSchema = z.enum(primaryGoals);

export const genders = ["male", "female", "other"] as const;
export type Gender = (typeof genders)[number];
export const genderSchema = z.enum(genders);

/** Type guard for narrowing a wire `string` to the `ActivityLevel` union. */
export function isActivityLevel(value: string): value is ActivityLevel {
  return (activityLevels as readonly string[]).includes(value);
}

/** Type guard for narrowing a wire `string` to the `PrimaryGoal` union. */
export function isPrimaryGoal(value: string): value is PrimaryGoal {
  return (primaryGoals as readonly string[]).includes(value);
}
