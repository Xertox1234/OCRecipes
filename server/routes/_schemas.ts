/**
 * Shared Zod validation schemas used across route modules.
 */
import { z } from "zod";
import { insertUserProfileSchema, allergySchema } from "@shared/schema";
import { measurementUnitSchema } from "@shared/lib/units";

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

// Login validation schema - lighter than registration (no format rules, just
// bounds). `username` holds EITHER a username or an email (the route branches
// on "@"; usernames are ^[a-zA-Z0-9_]+$ so the two never collide). The field
// name is kept so installed app versions keep working. 254 = max email length.
export const loginSchema = z.object({
  username: z.string().trim().min(1, "Username is required").max(254),
  password: z.string().min(1, "Password is required").max(200),
});

// The one server-side password rule — register AND reset. The client keeps a
// hand-synced mirror in client/screens/LoginScreen-utils.ts (validateNewPassword).
export const newPasswordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(200)
  .regex(
    /(?=.*[a-zA-Z])(?=.*\d)/,
    "Password must contain at least one letter and one number",
  );

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
  password: newPasswordSchema,
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Please enter a valid email address")
    .max(254),
  // COPPA 13+ age attestation — legal attestation at registration time,
  // not persisted to the DB. z.literal(true) rejects false/undefined/missing.
  ageConfirmed: z.literal(true, {
    errorMap: () => ({
      message: "You must confirm you are 13 years of age or older",
    }),
  }),
});

// Re-auth proof for sensitive account actions (delete account, connect a new
// sign-in method): the current password, OR a fresh Google/Apple token for an
// identity ALREADY linked to this account (social-only accounts have no
// password). The provider branch needs a `reauth` nonce bound to the caller.
export const reauthProofSchema = z.union([
  z.object({ password: z.string().min(1, "Password is required") }),
  z.object({
    provider: z.enum(["google", "apple"]),
    idToken: z.string().min(1).max(8192),
    nonce: z.string().min(1).max(200),
  }),
]);
export type ReauthProof = z.infer<typeof reauthProofSchema>;

export const deleteAccountSchema = reauthProofSchema;

// ── Two-step verification ───────────────────────────────────────────────────
const mfaChallengeToken = z.string().min(20).max(100);
const totpCode = z.string().regex(/^\d{6}$/, "Enter the 6-digit code");
const recoveryCodeInput = z.string().min(1).max(40);

/** POST /api/auth/mfa/verify — an app code OR a recovery code. */
export const mfaVerifySchema = z.union([
  z.object({ challenge: mfaChallengeToken, code: totpCode }),
  z.object({ challenge: mfaChallengeToken, recoveryCode: recoveryCodeInput }),
]);

// ── Sign in with Google / Apple ────────────────────────────────────────────
const providerEnum = z.enum(["google", "apple"]);
const tokenField = z.string().min(1).max(8192);
const ticketField = z.string().min(1).max(200);
const nonceField = z.string().min(1).max(200);

export const socialNonceSchema = z.object({
  purpose: z.enum(["sign_in", "link", "reauth"]),
});

export const socialSignInSchema = z.object({
  provider: providerEnum,
  idToken: tokenField,
  nonce: nonceField,
  authorizationCode: z.string().min(1).max(2048).optional(),
  fullName: z
    .object({
      givenName: z.string().max(100).nullable(),
      familyName: z.string().max(100).nullable(),
    })
    .optional(),
});

// Reuses registerSchema's rules so a social sign-up can never pick a username
// (or skip the COPPA attestation) that password registration would refuse.
export const completeSocialSignUpSchema = z.object({
  ticket: ticketField,
  username: registerSchema.shape.username,
  ageConfirmed: registerSchema.shape.ageConfirmed,
});

export const socialLinkSchema = z.union([
  z.object({ ticket: ticketField, password: z.string().min(1).max(200) }),
  z.object({
    ticket: ticketField,
    provider: providerEnum,
    idToken: tokenField,
    nonce: nonceField,
  }),
]);

// Owner ruling 2026-10-05: adding a sign-in method needs the same proof as
// deleting the account, so a briefly-borrowed session cannot plant a
// permanent login that survives a password reset.
export const connectIdentitySchema = socialSignInSchema
  .omit({ fullName: true })
  .extend({ proof: reauthProofSchema });

export const providerParamSchema = providerEnum;

// Normalized identically to registerSchema.email (trim + lowercase) so the
// per-email limiter key, the lookup, and the stored address agree.
const resetEmail = z
  .string()
  .trim()
  .toLowerCase()
  .email("Please enter a valid email address")
  .max(254);

export const forgotPasswordSchema = z.object({ email: resetEmail });

export const resetPasswordSchema = z.object({
  email: resetEmail,
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"),
  newPassword: newPasswordSchema,
});

// Email verification: the token is a stateless JWT (URL-delivered, can be long).
export const verifyEmailSchema = z.object({
  token: z.string().min(1, "Token is required").max(2000),
});

// Resend verification: email is normalized identically to registerSchema.
export const resendVerificationSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Please enter a valid email address")
    .max(254),
});

// Email change: `newEmail` is normalized identically to registerSchema (the
// storage layer + lower(email) unique index assume a trim+lowercase'd value);
// `password` re-authenticates the current account before the change is accepted.
export const changeEmailSchema = z.object({
  newEmail: z
    .string()
    .trim()
    .toLowerCase()
    .email("Please enter a valid email address")
    .max(254),
  password: z.string().min(1, "Password is required").max(200),
});

// Profile update validation schema
export const profileUpdateSchema = z.object({
  displayName: z.string().max(100).optional(),
  dailyCalorieGoal: z.number().int().min(500).max(10000).optional(),
  onboardingCompleted: z.boolean().optional(),
  measurementUnit: measurementUnitSchema.optional(),
});

// Enhanced user profile schema with proper validation for nested objects
export const userProfileInputSchema = insertUserProfileSchema
  .omit({
    // Consent timestamp is never client-supplied — the route stamps `new Date()`
    // server-side when `healthDataConsent === true`. Prevents client clock spoofing
    // and accidental erasure via profile updates.
    healthDataConsentAt: true,
  })
  .extend({
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
    // Boolean intent flag — `true` means the user accepted the consent screen.
    // The route translates this to a server-stamped `Date`. The actual
    // `healthDataConsentAt` timestamp column cannot be set or cleared by clients.
    healthDataConsent: z.boolean().optional(),
  });
