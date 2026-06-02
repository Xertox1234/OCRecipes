import { z } from "zod";

// Canonical user-goal enums live in shared/ (single source of truth, consumed by
// client and server). Import the types for internal use (Record keys, BMR formula)
// and the Zod enums to derive the physical-profile schema; re-export the types so
// existing consumers of this module keep working.
import {
  activityLevelSchema,
  primaryGoalSchema,
  genderSchema,
} from "@shared/types/user-goals";
import type {
  ActivityLevel,
  PrimaryGoal,
  Gender,
} from "@shared/types/user-goals";

export type {
  ActivityLevel,
  PrimaryGoal,
  Gender,
} from "@shared/types/user-goals";

// Validate user input with Zod (enums derived from the shared source of truth)
export const userPhysicalProfileSchema = z.object({
  weight: z.number().min(20).max(500), // kg, reasonable bounds
  height: z.number().min(50).max(300), // cm, reasonable bounds
  age: z.number().int().min(13).max(120),
  gender: genderSchema,
  activityLevel: activityLevelSchema,
  primaryGoal: primaryGoalSchema,
});

export type UserPhysicalProfile = z.infer<typeof userPhysicalProfileSchema>;

export interface CalculatedGoals {
  dailyCalories: number;
  dailyProtein: number; // grams
  dailyCarbs: number; // grams
  dailyFat: number; // grams
}

const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  athlete: 1.9,
};

const GOAL_MODIFIERS: Record<PrimaryGoal, number> = {
  lose_weight: -500,
  gain_muscle: 300,
  maintain: 0,
  eat_healthier: 0,
  manage_condition: 0,
};

const MACRO_SPLITS: Record<
  PrimaryGoal,
  { protein: number; carbs: number; fat: number }
> = {
  lose_weight: { protein: 0.4, carbs: 0.3, fat: 0.3 },
  gain_muscle: { protein: 0.35, carbs: 0.4, fat: 0.25 },
  maintain: { protein: 0.3, carbs: 0.4, fat: 0.3 },
  eat_healthier: { protein: 0.3, carbs: 0.45, fat: 0.25 },
  manage_condition: { protein: 0.3, carbs: 0.4, fat: 0.3 },
};

// Minimum safe calorie intake
const MIN_DAILY_CALORIES = 1200;

/**
 * Calculate Basal Metabolic Rate using Mifflin-St Jeor formula
 */
function calculateBMR(
  weight: number,
  height: number,
  age: number,
  gender: Gender,
): number {
  // Mifflin-St Jeor formula
  const baseBMR = 10 * weight + 6.25 * height - 5 * age;

  if (gender === "male") {
    return baseBMR + 5;
  } else {
    // female and other use female formula as it's more conservative
    return baseBMR - 161;
  }
}

/**
 * Calculate Total Daily Energy Expenditure
 */
function calculateTDEE(bmr: number, activityLevel: ActivityLevel): number {
  const multiplier = ACTIVITY_MULTIPLIERS[activityLevel];
  return bmr * multiplier;
}

/**
 * Calculate daily nutrition goals from physical profile
 */
export function calculateGoals(profile: UserPhysicalProfile): CalculatedGoals {
  const bmr = calculateBMR(
    profile.weight,
    profile.height,
    profile.age,
    profile.gender,
  );
  const tdee = calculateTDEE(bmr, profile.activityLevel);

  // Apply goal modifier (no fallback needed - type ensures valid key)
  const modifier = GOAL_MODIFIERS[profile.primaryGoal];
  let dailyCalories = Math.round(tdee + modifier);

  // Safety guardrail: minimum calorie intake
  dailyCalories = Math.max(MIN_DAILY_CALORIES, dailyCalories);

  // Get macro split for goal (no fallback needed - type ensures valid key)
  const split = MACRO_SPLITS[profile.primaryGoal];

  return {
    dailyCalories,
    dailyProtein: Math.round((dailyCalories * split.protein) / 4), // 4 cal/g protein
    dailyCarbs: Math.round((dailyCalories * split.carbs) / 4), // 4 cal/g carbs
    dailyFat: Math.round((dailyCalories * split.fat) / 9), // 9 cal/g fat
  };
}
