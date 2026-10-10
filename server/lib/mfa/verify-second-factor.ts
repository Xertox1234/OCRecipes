import { MFA_TOTP_FAILURE_CAP } from "@shared/constants/mfa";
import { storage } from "../../storage";
import { sendTwoFactorNotice } from "../../services/email";
import { fireAndForget } from "../fire-and-forget";
import { logger } from "../logger";
import { base32Decode, matchTotp } from "./totp";
import {
  decryptMfaSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
} from "./mfa-secrets";

export type SecondFactorProof = { code: string } | { recoveryCode: string };
export type SecondFactorResult =
  | { ok: true; replacementRecoveryCode?: string }
  | { ok: false; reason: "invalid" | "unavailable" };

const INVALID = { ok: false, reason: "invalid" } as const;

type NoticeUser = { id: string; email: string; username: string };

/** Count one failure; the failure that starts a lock emails the owner. */
async function fail(user: NoticeUser): Promise<SecondFactorResult> {
  const { tripped } = await storage.recordMfaFailure(user.id);
  if (tripped) {
    fireAndForget(
      "mfa-notice",
      sendTwoFactorNotice(user.email, user.username, "locked"),
    );
  }
  return INVALID;
}

/**
 * Check an authenticator code or a recovery code for an account with MFA on.
 * Spec §3.2: a lock refuses both kinds without counting (one generic answer);
 * past MFA_TOTP_FAILURE_CAP consecutive failures only a recovery code works.
 * Never logs the code, the recovery code or the secret.
 */
export async function verifySecondFactor(
  user: NoticeUser,
  proof: SecondFactorProof,
  nowMs: number = Date.now(),
): Promise<SecondFactorResult> {
  const active = await storage.getActiveTotp(user.id);
  if (!active || active.locked) return INVALID;

  if ("recoveryCode" in proof) {
    const normalized = normalizeRecoveryCode(proof.recoveryCode);
    if (!normalized) return fail(user);
    const replacement = generateRecoveryCodes(1)[0];
    const consumed = await storage.consumeRecoveryCode(
      user.id,
      hashRecoveryCode(user.id, normalized),
      hashRecoveryCode(user.id, normalizeRecoveryCode(replacement)!),
    );
    if (!consumed) return fail(user);
    fireAndForget(
      "mfa-notice",
      sendTwoFactorNotice(user.email, user.username, "recovery_code_used"),
    );
    return { ok: true, replacementRecoveryCode: replacement };
  }

  if (active.failedAttempts >= MFA_TOTP_FAILURE_CAP) return INVALID;

  let secret: Buffer;
  try {
    secret = base32Decode(decryptMfaSecret(active.secretEnc));
  } catch (err) {
    // Missing key, wrong-length key, or a rotated key failing GCM auth. The
    // person did nothing wrong, so nothing is counted. Class name only.
    logger.error(
      { errorClass: err instanceof Error ? err.name : typeof err },
      "MFA secret unavailable",
    );
    return { ok: false, reason: "unavailable" };
  }

  const step = matchTotp(secret, proof.code, nowMs);
  if (step === null) return fail(user);
  if (!(await storage.acceptTotpStep(user.id, step))) return fail(user);
  return { ok: true };
}
