import crypto from "node:crypto";
import {
  MFA_RECOVERY_CODE_BYTES,
  MFA_RECOVERY_CODE_COUNT,
  TOTP_SECRET_BYTES,
} from "@shared/constants/mfa";
import { decryptToken, encryptToken } from "../social-identity/token-crypto";
import { base32Encode } from "./totp";

/** MFA_SECRET_ENC_KEY is unset — 2FA setup is unavailable on this server. */
export class MfaUnavailableError extends Error {
  constructor() {
    super("MFA_SECRET_ENC_KEY is not set");
  }
}

// Independent of JWT_SECRET and IDENTITY_TOKEN_ENC_KEY on purpose: rotating
// either must never make stored authenticator secrets unreadable.
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

/** AES-256-GCM, same blob format as token-crypto, keyed by MFA_SECRET_ENC_KEY. */
export function encryptMfaSecret(b32: string, key: Buffer = loadMfaKey()) {
  return encryptToken(b32, key);
}

export function decryptMfaSecret(blob: string, key: Buffer = loadMfaKey()) {
  return decryptToken(blob, key);
}

export function newTotpSecret(): string {
  return base32Encode(crypto.randomBytes(TOTP_SECRET_BYTES));
}

/** Display form XXXX-XXXX-XXXX-XXXX; 80 random bits each. */
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

// Recovery codes and challenge tokens are ≥ 80 random bits, so a plain
// SHA-256 can't be brute-forced from a database leak — and with no server key,
// rotating any secret never invalidates them.
export function hashRecoveryCode(userId: string, normalized: string): string {
  return crypto
    .createHash("sha256")
    .update(`${userId}:${normalized}`)
    .digest("hex");
}

export function newChallengeToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashChallengeToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
