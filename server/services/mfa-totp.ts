import type { User } from "@shared/schema";
import { storage } from "../storage";
import { sendTwoFactorNotice } from "./email";
import { fireAndForget } from "../lib/fire-and-forget";
import { base32Decode, matchTotp, otpauthUrl } from "../lib/mfa/totp";
import {
  decryptMfaSecret,
  encryptMfaSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
  mfaConfigured,
  newTotpSecret,
  normalizeRecoveryCode,
} from "../lib/mfa/mfa-secrets";

// Authenticator setup shared by /api/auth/mfa/totp/* (signed in) and
// /api/auth/upgrade/totp/* (a short password's pass) — password policy spec
// §6. Callers have already authenticated the user and map results to
// responses. Never log a code, secret or recovery code.

/** No MFA_SECRET_ENC_KEY: authenticator secrets can't be stored or read. */
export class TotpUnavailableError extends Error {}

/** Stage a fresh secret (first setup or new phone) and hand it to the app once. */
export async function stageTotpSecret(
  user: Pick<User, "id" | "username">,
): Promise<{ secret: string; otpauthUrl: string }> {
  if (!mfaConfigured()) throw new TotpUnavailableError();
  const secret = newTotpSecret();
  await storage.startTotpEnrollment(user.id, encryptMfaSecret(secret));
  return { secret, otpauthUrl: otpauthUrl(secret, user.username) };
}

/** Check a code against the staged (pending) secret; returns its time step. */
export async function checkPendingTotpCode(
  userId: string,
  code: string,
): Promise<
  { ok: true; step: number } | { ok: false; reason: "wrong_code" | "unavailable" }
> {
  const pendingEnc = await storage.getPendingTotpSecret(userId);
  if (!pendingEnc) return { ok: false, reason: "wrong_code" };
  let secret: Buffer;
  try {
    secret = base32Decode(decryptMfaSecret(pendingEnc));
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  const step = matchTotp(secret, code, Date.now());
  return step === null
    ? { ok: false, reason: "wrong_code" }
    : { ok: true, step };
}

/**
 * First setup: promote the pending secret and issue recovery codes. Through a
 * short password's pass, the pass is consumed in the same transaction.
 * Returns the plain codes (shown once), or undefined when the storage guard
 * refused (already on, nothing pending, or the pass was spent / outdated).
 */
export async function confirmFirstEnrollment(
  user: User,
  step: number,
  opts: { upgradePass?: { idHash: string; tokenVersion: number } } = {},
): Promise<string[] | undefined> {
  const recoveryCodes = generateRecoveryCodes();
  const version = await storage.confirmTotpEnrollment(user.id, {
    acceptedStep: step,
    recoveryHashes: recoveryCodes.map((c) =>
      hashRecoveryCode(user.id, normalizeRecoveryCode(c)!),
    ),
    ...(opts.upgradePass ? { upgradePass: opts.upgradePass } : {}),
  });
  if (version === undefined) return undefined;
  fireAndForget(
    "mfa-notice",
    sendTwoFactorNotice(
      user.email,
      user.username,
      opts.upgradePass ? "enabled_at_sign_in" : "enabled",
    ),
  );
  return recoveryCodes;
}
