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

/**
 * The account's two-step state changed after the caller checked it (a setup
 * racing a confirm) — nothing was staged (audit L13). `mfaEnabled` is the
 * state the caller expected.
 */
export class TotpStateChangedError extends Error {
  constructor(readonly mfaEnabled: boolean) {
    super("two-step state changed");
  }
}

/**
 * Stage a fresh secret (first setup or new phone) and hand it to the app once.
 * Staged only while the account is still in the state the caller checked
 * (`user.mfaEnabledAt`), so a setup racing the owner's confirm can't leave a
 * pending secret that a bare session could confirm as a "new phone".
 */
export async function stageTotpSecret(
  user: Pick<User, "id" | "username" | "mfaEnabledAt">,
): Promise<{ secret: string; otpauthUrl: string }> {
  if (!mfaConfigured()) throw new TotpUnavailableError();
  const secret = newTotpSecret();
  const mfaEnabled = user.mfaEnabledAt !== null;
  const staged = await storage.startTotpEnrollment(
    user.id,
    encryptMfaSecret(secret),
    { mfaEnabled },
  );
  if (!staged) throw new TotpStateChangedError(mfaEnabled);
  return { secret, otpauthUrl: otpauthUrl(secret, user.username) };
}

/**
 * Check a code against the staged (pending) secret; returns its time step. A
 * wrong code counts toward the same lock as every other factor check (spec
 * §6, audit L9); a locked account's pending secret reads as nothing pending.
 */
export async function checkPendingTotpCode(
  user: Pick<User, "id" | "email" | "username">,
  code: string,
): Promise<
  | { ok: true; step: number }
  | { ok: false; reason: "wrong_code" | "unavailable" }
> {
  const pendingEnc = await storage.getPendingTotpSecret(user.id);
  if (!pendingEnc) return { ok: false, reason: "wrong_code" };
  let secret: Buffer;
  try {
    secret = base32Decode(decryptMfaSecret(pendingEnc));
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  const step = matchTotp(secret, code, Date.now());
  if (step !== null) return { ok: true, step };
  const { tripped } = await storage.recordMfaFailure(user.id);
  if (tripped) {
    fireAndForget(
      "mfa-notice",
      sendTwoFactorNotice(user.email, user.username, "locked"),
    );
  }
  return { ok: false, reason: "wrong_code" };
}

/**
 * First setup: promote the pending secret and issue recovery codes. Through a
 * short password's pass, the pass is consumed in the same transaction.
 * Returns the plain codes (shown once) and the tokenVersion the enrolment
 * bumped to — mint the session only under it (auth audit L1, as L12) — or
 * undefined when the storage guard refused (already on, nothing pending, or
 * the pass was spent / outdated).
 */
export async function confirmFirstEnrollment(
  user: User,
  step: number,
  opts: { upgradePass?: { idHash: string; tokenVersion: number } } = {},
): Promise<{ recoveryCodes: string[]; tokenVersion: number } | undefined> {
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
  return { recoveryCodes, tokenVersion: version };
}
