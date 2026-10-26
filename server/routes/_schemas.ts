/**
 * Shared Zod validation schemas used across route modules.
 */
import { z } from "zod";
import { insertUserProfileSchema, allergySchema } from "@shared/schema";
import { measurementUnitSchema } from "@shared/lib/units";
import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  passwordLength,
} from "@shared/constants/password-policy";
import {
  USERNAME_MAX,
  USERNAME_MIN,
  USERNAME_PATTERN,
} from "@shared/constants/username";

// Raw UTF-16 cap on every password field, new or current. 128 code points can
// be up to 256 UTF-16 units (emoji), so the cap sits well above that: any
// password the new-password rule accepts must also be accepted wherever it is
// proved later (sign-in, re-auth, linking).
const PASSWORD_INPUT_MAX_UNITS = 512;

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
  password: z
    .string()
    .min(1, "Password is required")
    .max(PASSWORD_INPUT_MAX_UNITS),
  /** "Trust this phone" key from a previous two-step sign-in (spec D5). */
  trustKey: z.string().min(20).max(100).optional(),
});

// The one server-side new-password rule (register, reset, disable). Checks the
// FLOOR (8) and the max in code points; the state-dependent 15 is applied in
// the route, where the account is known (spec §2). No composition rule.
export const newPasswordSchema = z
  .string()
  .max(PASSWORD_INPUT_MAX_UNITS)
  .superRefine((pw, ctx) => {
    const n = passwordLength(pw);
    if (n < PASSWORD_MIN)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Use at least ${PASSWORD_MIN} characters.`,
      });
    if (n > PASSWORD_MAX)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Use at most ${PASSWORD_MAX} characters.`,
      });
  });

// Registration validation schema with username format and password strength
export const registerSchema = z.object({
  username: z
    .string()
    .min(USERNAME_MIN, `Username must be at least ${USERNAME_MIN} characters`)
    .max(USERNAME_MAX, `Username must be at most ${USERNAME_MAX} characters`)
    .regex(
      USERNAME_PATTERN,
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
  // The "Use two-step verification" switch (password policy spec P4): sets
  // the minimum only (8 on, 15 off) and is never stored.
  twoStep: z.boolean().optional().default(false),
});

// Re-auth proof for sensitive account actions (delete account, connect a new
// sign-in method): the current password, OR a fresh Google/Apple token for an
// identity ALREADY linked to this account (social-only accounts have no
// password). The provider branch needs a `reauth` nonce bound to the caller.
/** The 6-digit code from the two-step email. */
export const secondFactorSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"),
});

export const reauthProofSchema = z.union([
  z.object({
    password: z.string().min(1, "Password is required"),
    secondFactor: secondFactorSchema.optional(),
  }),
  z.object({
    provider: z.enum(["google", "apple"]),
    idToken: z.string().min(1).max(8192),
    nonce: z.string().min(1).max(200),
  }),
]);
export type ReauthProof = z.infer<typeof reauthProofSchema>;

// Signed-in password change (change-password spec §4.1). The password and
// Google/Apple variants are reauthProofSchema's own, unchanged; the emailed
// change code never needs a second code (it proves the same inbox).
export const changePasswordSchema = z.object({
  proof: z.union([
    ...reauthProofSchema.options,
    z.object({
      emailCode: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"),
    }),
  ]),
  newPassword: newPasswordSchema,
});

export const deleteAccountSchema = reauthProofSchema;

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
  z.object({
    ticket: ticketField,
    password: z.string().min(1).max(PASSWORD_INPUT_MAX_UNITS),
  }),
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
  password: z
    .string()
    .min(1, "Password is required")
    .max(PASSWORD_INPUT_MAX_UNITS),
  secondFactor: secondFactorSchema.optional(),
});

// ── Two-step verification ──────────────────────────────────────────────────
export const mfaPasswordSchema = z.object({
  password: z
    .string()
    .min(1, "Password is required")
    .max(PASSWORD_INPUT_MAX_UNITS),
});
export const mfaDisableSchema = mfaPasswordSchema.extend({
  secondFactor: secondFactorSchema,
});
export const mfaConfirmSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"),
});

export const mfaEmailResendSchema = z.object({
  challenge: z.string().min(20).max(100),
});

export const mfaVerifySchema = z.object({
  challenge: z.string().min(20).max(100),
  secondFactor: secondFactorSchema,
  trustDevice: z.boolean().optional(),
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
