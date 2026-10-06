import { MFA_TOTP_FAILURE_CAP } from "@shared/constants/mfa";
import { storage } from "../../storage";
import { base32Decode, matchTotp } from "./totp";
import {
  decryptMfaSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
} from "./mfa-secrets";

export type SecondFactorProof = { code: string } | { recoveryCode: string };

export type SecondFactorResult =
  | { ok: true; usedRecoveryCode: false }
  | { ok: true; usedRecoveryCode: true; replacementRecoveryCode: string }
  | { ok: false; reason: "invalid" | "locked" };

const INVALID = { ok: false, reason: "invalid" } as const;

/**
 * Check a second factor for an account with 2FA on. No HTTP: callers map
 * `locked` → 429 and `invalid` → 401. Every non-locked failure is counted
 * exactly once (recordMfaFailure); a lock is answered without counting.
 */
export async function verifySecondFactor(
  userId: string,
  proof: SecondFactorProof,
  nowMs: number = Date.now(),
): Promise<SecondFactorResult> {
  const active = await storage.getActiveTotp(userId);
  if (!active) return INVALID;
  if (active.locked) return { ok: false, reason: "locked" };

  const fail = async () => {
    await storage.recordMfaFailure(userId);
    return INVALID;
  };

  if ("recoveryCode" in proof) {
    const normalized = normalizeRecoveryCode(proof.recoveryCode);
    if (!normalized) return fail();
    const [replacement] = generateRecoveryCodes(1);
    const used = await storage.consumeRecoveryCode(
      userId,
      hashRecoveryCode(userId, normalized),
      hashRecoveryCode(userId, replacement.replace(/-/g, "")),
    );
    if (!used) return fail();
    return {
      ok: true,
      usedRecoveryCode: true,
      replacementRecoveryCode: replacement,
    };
  }

  // SP 800-63B-4 cap: past it the app code is disabled; a recovery code is
  // the only way back in (and a successful one resets the count).
  if (active.failedAttempts >= MFA_TOTP_FAILURE_CAP) return fail();

  const secret = base32Decode(decryptMfaSecret(active.secretEnc));
  const step = matchTotp(secret, proof.code, nowMs);
  if (step === null) return fail();
  // Refused when the step is not newer than the last accepted one (replay)
  // or a lock began since the read above.
  if (!(await storage.acceptTotpStep(userId, step))) return fail();
  return { ok: true, usedRecoveryCode: false };
}
