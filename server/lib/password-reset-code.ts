import crypto from "node:crypto";
import { RESET_CODE_LENGTH } from "@shared/constants/password-reset";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required");
}

// Domain-separated subkey: the reset-code HMAC never shares a key with JWT
// signing even though both derive from JWT_SECRET. Rotating JWT_SECRET
// invalidates live codes (acceptable — they last 15 minutes). A plain SHA-256
// over a 10^6 code space is reversible from a DB leak in milliseconds; the
// keyed HMAC is not without the server secret.
const HMAC_KEY = crypto
  .createHmac("sha256", JWT_SECRET)
  .update("password-reset-code:v1")
  .digest();

/** Stand-in id for the unknown-account branch, so both branches do one HMAC. */
export const DUMMY_RESET_USER_ID = "00000000-0000-0000-0000-000000000000";
/** Stand-in stored hash for the unknown-account branch (never a real HMAC). */
export const DUMMY_RESET_HASH = "0".repeat(64);

export function generateResetCode(): string {
  return crypto
    .randomInt(0, 10 ** RESET_CODE_LENGTH)
    .toString()
    .padStart(RESET_CODE_LENGTH, "0");
}

export function hashResetCode(userId: string, code: string): string {
  return crypto
    .createHmac("sha256", HMAC_KEY)
    .update(`${userId}:${code}`)
    .digest("hex");
}

/** Constant-time comparison of a submitted code against the stored HMAC. */
export function resetCodeMatches(
  userId: string,
  code: string,
  storedHash: string,
): boolean {
  const expected = Buffer.from(hashResetCode(userId, code), "hex");
  const stored = Buffer.from(storedHash, "hex");
  if (stored.length !== expected.length) {
    // Burn the same compare cost, then fail — malformed input is never a match.
    crypto.timingSafeEqual(expected, expected);
    return false;
  }
  return crypto.timingSafeEqual(expected, stored);
}
