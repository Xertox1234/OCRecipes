import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required");
}
const jwtSecret: string = JWT_SECRET;

// Same issuer as access tokens, but a DISTINCT audience — this partitions
// verification tokens from access tokens so neither can be used as the other,
// even though they share JWT_SECRET. The verify token also carries no
// tokenVersion, so it fails the access-token payload guard in requireAuth.
const VERIFY_ISSUER = "ocrecipes-api";
const VERIFY_AUDIENCE = "ocrecipes-email-verify";
const VERIFY_TTL = "24h";

export interface VerificationTokenPayload {
  sub: string;
  email: string;
  purpose: "email-verify";
}

export function signVerificationToken(userId: string, email: string): string {
  return jwt.sign({ email, purpose: "email-verify" }, jwtSecret, {
    subject: userId,
    audience: VERIFY_AUDIENCE,
    issuer: VERIFY_ISSUER,
    expiresIn: VERIFY_TTL,
  });
}

export function verifyVerificationToken(
  token: string,
): VerificationTokenPayload | null {
  try {
    const payload = jwt.verify(token, jwtSecret, {
      audience: VERIFY_AUDIENCE,
      issuer: VERIFY_ISSUER,
    });
    if (
      typeof payload === "object" &&
      payload !== null &&
      typeof payload.sub === "string" &&
      payload.sub.length > 0 &&
      typeof (payload as Record<string, unknown>).email === "string" &&
      (payload as Record<string, unknown>).purpose === "email-verify"
    ) {
      return {
        sub: payload.sub,
        email: (payload as { email: string }).email,
        purpose: "email-verify",
      };
    }
    return null;
  } catch {
    // Expired, wrong audience/issuer, or tampered — all collapse to null so
    // callers cannot distinguish failure modes.
    return null;
  }
}
