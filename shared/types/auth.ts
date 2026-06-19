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
