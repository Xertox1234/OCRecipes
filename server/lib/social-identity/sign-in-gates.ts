import { ErrorCode } from "@shared/constants/error-codes";

export type GateResult =
  | { ok: true }
  | { ok: false; status: 403; code: string; message: string };

/** Two-step verification is on (users.mfa_enabled_at). Feeds decideLink. */
function requiresSecondFactor(user: { mfaEnabledAt: Date | null }): boolean {
  return user.mfaEnabledAt !== null;
}
export const secondFactor = { requiresSecondFactor };

/**
 * The gate every social sign-in passes BEFORE anything is linked or a session
 * issued: email verification (mirrors /api/auth/login's EMAIL_NOT_VERIFIED).
 * D1: a Google/Apple proof never needs our second factor; password proofs are
 * gated in server/lib/mfa/.
 */
export function signInGate(
  user: { id: string; emailVerified: boolean },
  opts: { emailWillBeVerified: boolean; verificationOn: boolean },
): GateResult {
  if (opts.verificationOn && !user.emailVerified && !opts.emailWillBeVerified) {
    return {
      ok: false,
      status: 403,
      code: ErrorCode.EMAIL_NOT_VERIFIED,
      message: "Email not verified",
    };
  }
  return { ok: true };
}
