// JWT types (AccessTokenPayload, isAccessTokenPayload) are server-only.
// Import from server/lib/jwt-types.ts instead to avoid pulling jsonwebtoken into client bundles.

import type { MeasurementUnit } from "@shared/lib/units";
import type { SubscriptionTier } from "@shared/types/premium";

// User type for client-side auth
export interface User {
  id: string;
  username: string;
  email?: string;
  emailVerified?: boolean;
  displayName?: string;
  avatarUrl?: string | null;
  dailyCalorieGoal?: number;
  onboardingCompleted?: boolean;
  subscriptionTier?: SubscriptionTier;
  measurementUnit?: MeasurementUnit;
}

// API response types
export interface AuthResponse {
  user: User;
  token: string;
}

export interface ApiError {
  error: string;
  code?:
    | "TOKEN_EXPIRED"
    | "TOKEN_INVALID"
    | "TOKEN_REVOKED"
    | "NO_TOKEN"
    | "EMAIL_NOT_VERIFIED"
    | "MFA_CHALLENGE_EXPIRED"
    | "INVALID_SECOND_FACTOR"
    | "MFA_UNAVAILABLE"
    | "SECOND_FACTOR_REQUIRED";
}

// ── Two-step verification ───────────────────────────────────────────────────
/** An authenticator-app code, or one of the saved recovery codes. */
export type SecondFactorInput = { code: string } | { recoveryCode: string };
/** A correct password on a 2FA account: answer the challenge with a code. */
export type MfaChallengeResult = { status: "mfa_required"; challenge: string };
export type SignedInResult = { status: "signed_in"; user: User; token: string };
/**
 * A correct password under 15 on an account without two-step (password
 * policy spec §5.2): a short-lived pass, no session. The pass lives only in
 * memory and is sent as `Authorization: UpgradePass <pass>`.
 */
export type UpgradeRequiredResult = {
  status: "upgrade_required";
  pass: string;
  canUseTwoStep: boolean;
};
/** POST /api/auth/login and the password branch of /api/auth/social/link. */
export type SessionResult =
  | SignedInResult
  | MfaChallengeResult
  | UpgradeRequiredResult;
/** POST /api/auth/mfa/verify. */
export interface MfaVerifyResult extends SignedInResult {
  /** "Trust this phone" key — stored in the Keychain, sent on later sign-ins. */
  trustKey?: string;
  /** A recovery code was spent: show this new one once so it can be saved. */
  replacementRecoveryCode?: string;
}

// ── Sign in with Google / Apple ─────────────────────────────────────────────
export type SocialProvider = "google" | "apple";
export type SignInMethod = "password" | SocialProvider;

/** POST /api/auth/social (and the sign-up / link follow-ups). */
export type SocialSignInResult =
  | { status: "signed_in"; user: User; token: string }
  | { status: "choose_username"; ticket: string; suggestedUsername: string }
  | {
      status: "link_required";
      ticket: string;
      methods: SignInMethod[];
      email: string;
    };

/** /api/auth/me → signInMethods (mirrors server/storage/identities.ts). */
export interface SignInMethods {
  password: boolean;
  google: { email: string | null } | null;
  apple: { email: string | null; isPrivateRelay: boolean } | null;
}
