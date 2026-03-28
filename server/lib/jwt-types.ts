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
    payload.sub.length > 0 &&
    typeof (payload as Record<string, unknown>).tokenVersion === "number"
  );
}
