import { ErrorCode } from "@shared/constants/error-codes";

export type GateResult =
  | { ok: true }
  | { ok: false; status: 403; code: string; message: string };

/** True when the account has turned on 2FA (users.mfa_enabled_at is set). */
function requiresSecondFactor(user: { mfaEnabledAt: Date | null }): boolean {
  return user.mfaEnabledAt !== null;
}
// An object (not a bare export) so tests can spy on it.
export const secondFactor = { requiresSecondFactor };

/**
 * The email-verification gate every social sign-in passes BEFORE anything is
 * linked or a session issued (mirrors /api/auth/login's EMAIL_NOT_VERIFIED).
 * The second factor is NOT checked here: beginSession
 * (server/lib/mfa/begin-session.ts), which every existing-account session goes
 * through, answers a 2FA account with a challenge instead of a session.
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
