/**
 * Shared Zod validation schemas used across route modules.
 */
import { z } from "zod";
import { insertUserProfileSchema, allergySchema } from "@shared/schema";

/** Zod schema: accepts string or number, coerces to string. Returns undefined if absent. */
export const numericStringField = z
  .union([z.string(), z.number()])
  .optional()
  .transform((v) => v?.toString());

/** Zod schema: accepts string or number, coerces to string. Returns null if absent. */
export const nullableNumericStringField = z
  .union([z.string(), z.number()])
  .optional()
  .nullable()
  .transform((v) => v?.toString() ?? null);

// Login validation schema - lighter than registration (no format rules, just bounds)
export const loginSchema = z.object({
  username: z.string().min(1, "Username is required").max(30),
  password: z.string().min(1, "Password is required").max(200),
});

// Registration validation schema with username format and password strength
export const registerSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(30, "Username must be at most 30 characters")
    .regex(
      /^[a-zA-Z0-9_]+$/,
      "Username can only contain letters, numbers, and underscores",
    ),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(200)
    .regex(
      /(?=.*[a-zA-Z])(?=.*\d)/,
      "Password must contain at least one letter and one number",
    ),
  // COPPA 13+ age attestation — legal attestation at registration time,
  // not persisted to the DB. z.literal(true) rejects false/undefined/missing.
  ageConfirmed: z.literal(true, {
    errorMap: () => ({
      message: "You must confirm you are 13 years of age or older",
    }),
  }),
});

// Account deletion validation schema
export const deleteAccountSchema = z.object({
  password: z.string().min(1, "Password is required"),
});

// Profile update validation schema
export const profileUpdateSchema = z.object({
  displayName: z.string().max(100).optional(),
  dailyCalorieGoal: z.number().int().min(500).max(10000).optional(),
  onboardingCompleted: z.boolean().optional(),
});

// Enhanced user profile schema with proper validation for nested objects
export const userProfileInputSchema = insertUserProfileSchema.extend({
  allergies: z.array(allergySchema).max(30).optional(),
  healthConditions: z.array(z.string().max(200)).max(20).optional(),
  foodDislikes: z.array(z.string().max(100)).max(50).optional(),
  cuisinePreferences: z.array(z.string().max(100)).max(20).optional(),
  householdSize: z.number().int().min(1).max(20).optional(),
  dietType: z.string().max(50).optional().nullable(),
  primaryGoal: z.string().max(100).optional().nullable(),
  activityLevel: z.string().max(50).optional().nullable(),
  cookingSkillLevel: z.string().max(50).optional().nullable(),
  cookingTimeAvailable: z.string().max(50).optional().nullable(),
});
