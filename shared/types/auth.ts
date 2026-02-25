import { JwtPayload } from "jsonwebtoken";

// JWT payload structure
export interface AccessTokenPayload extends JwtPayload {
  sub: string; // User ID
  tokenVersion: number; // Token version for revocation
}

// Type guard for payload validation
export function isAccessTokenPayload(
  payload: string | JwtPayload,
): payload is AccessTokenPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    typeof payload.sub === "string" &&
    typeof (payload as Record<string, unknown>).tokenVersion === "number"
  );
}

// User type for client-side auth
export interface User {
  id: string;
  username: string;
  displayName?: string;
  avatarUrl?: string | null;
  dailyCalorieGoal?: number;
  onboardingCompleted?: boolean;
  subscriptionTier?: "free" | "premium";
}

// API response types
export interface AuthResponse {
  user: User;
  token: string;
}

export interface ApiError {
  error: string;
  code?: "TOKEN_EXPIRED" | "TOKEN_INVALID" | "TOKEN_REVOKED" | "NO_TOKEN";
}
