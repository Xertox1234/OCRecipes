import crypto from "node:crypto";
import {
  MFA_RECOVERY_CODE_BYTES,
  MFA_RECOVERY_CODE_COUNT,
  TOTP_SECRET_BYTES,
} from "@shared/constants/mfa";
import { decryptToken, encryptToken } from "../social-identity/token-crypto";
import { base32Encode } from "./totp";

export class MfaUnavailableError extends Error {
  constructor() {
    super("MFA_SECRET_ENC_KEY is not set");
  }
}

// Independent of JWT_SECRET and IDENTITY_TOKEN_ENC_KEY: rotating either must
// never make stored authenticator secrets unreadable.
export function loadMfaKey(
  raw: string | undefined = process.env.MFA_SECRET_ENC_KEY,
): Buffer {
  if (!raw) throw new MfaUnavailableError();
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("MFA_SECRET_ENC_KEY must decode to 32 bytes");
  }
  return key;
}

export function mfaConfigured(): boolean {
  try {
    loadMfaKey();
    return true;
  } catch {
    return false;
  }
}

export const encryptMfaSecret = (b32: string, key = loadMfaKey()) =>
  encryptToken(b32, key);
export const decryptMfaSecret = (blob: string, key = loadMfaKey()) =>
  decryptToken(blob, key);

export function newTotpSecret(): string {
  return base32Encode(crypto.randomBytes(TOTP_SECRET_BYTES));
}

export function generateRecoveryCodes(
  n: number = MFA_RECOVERY_CODE_COUNT,
): string[] {
  const codes = new Set<string>();
  while (codes.size < n) {
    const raw = base32Encode(crypto.randomBytes(MFA_RECOVERY_CODE_BYTES));
    codes.add(raw.match(/.{4}/g)!.join("-"));
  }
  return [...codes];
}

/** Upper-case, drop spaces/dashes; null unless exactly 16 base32 chars. */
export function normalizeRecoveryCode(input: string): string | null {
  const clean = input.toUpperCase().replace(/[\s-]/g, "");
  return /^[A-Z2-7]{16}$/.test(clean) ? clean : null;
}

export function hashRecoveryCode(userId: string, normalized: string): string {
  return crypto
    .createHash("sha256")
    .update(`mfa-recovery:${userId}:${normalized}`)
    .digest("hex");
}

export function newChallengeToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashChallengeToken(token: string): string {
  return crypto
    .createHash("sha256")
    .update(`mfa-challenge:${token}`)
    .digest("hex");
}

export function newTrustKey(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashTrustKey(key: string): string {
  return crypto.createHash("sha256").update(`mfa-trust:${key}`).digest("hex");
}
