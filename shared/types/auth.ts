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
    | "EMAIL_NOT_VERIFIED";
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
