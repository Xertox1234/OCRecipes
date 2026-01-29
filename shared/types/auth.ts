import { JwtPayload } from "jsonwebtoken";

// JWT payload structure
export interface AccessTokenPayload extends JwtPayload {
  sub: string; // User ID
}

// Type guard for payload validation
export function isAccessTokenPayload(
  payload: string | JwtPayload,
): payload is AccessTokenPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    typeof payload.sub === "string"
  );
}

// API response types
export interface AuthResponse {
  user: {
    id: string;
    username: string;
    displayName?: string;
    dailyCalorieGoal?: number;
    onboardingCompleted?: boolean;
  };
  token: string;
}

export interface ApiError {
  error: string;
  code?: "TOKEN_EXPIRED" | "TOKEN_INVALID" | "NO_TOKEN";
}
