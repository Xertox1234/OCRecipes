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

/**
 * HMAC for the signed-in change-password code (change-password spec §4.2).
 * Same key as reset codes, but a distinct `pw-change:` prefix: a change-code
 * hash never equals a reset-code hash for the same user and digits, so one
 * kind of code can never be spent as the other.
 */
export function hashChangeCode(userId: string, code: string): string {
  return crypto
    .createHmac("sha256", HMAC_KEY)
    .update(`pw-change:${userId}:${code}`)
    .digest("hex");
}

/** Constant-time comparison of a submitted change code against the stored HMAC. */
export function changeCodeMatches(
  userId: string,
  code: string,
  storedHash: string,
): boolean {
  const expected = Buffer.from(hashChangeCode(userId, code), "hex");
  const stored = Buffer.from(storedHash, "hex");
  if (stored.length !== expected.length) {
    // Burn the same compare cost, then fail — malformed input is never a match.
    crypto.timingSafeEqual(expected, expected);
    return false;
  }
  return crypto.timingSafeEqual(expected, stored);
}

/**
 * HMAC for the two-step code emailed at sign-in (owner ruling 4, 2026-10-12).
 * Its own `mfa-email:` prefix, so it never equals a reset or change-code hash
 * for the same user and digits: no kind of code can be spent as another.
 */
export function hashSignInCode(userId: string, code: string): string {
  return crypto
    .createHmac("sha256", HMAC_KEY)
    .update(`mfa-email:${userId}:${code}`)
    .digest("hex");
}

/** Constant-time comparison of a submitted sign-in code against the stored HMAC. */
export function signInCodeMatches(
  userId: string,
  code: string,
  storedHash: string,
): boolean {
  const expected = Buffer.from(hashSignInCode(userId, code), "hex");
  const stored = Buffer.from(storedHash, "hex");
  if (stored.length !== expected.length) {
    // Burn the same compare cost, then fail — malformed input is never a match.
    crypto.timingSafeEqual(expected, expected);
    return false;
  }
  return crypto.timingSafeEqual(expected, stored);
}
