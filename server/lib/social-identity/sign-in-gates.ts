import { ErrorCode } from "@shared/constants/error-codes";

export type GateResult =
  | { ok: true }
  | { ok: false; status: 403; code: string; message: string };

/** MFA hook point. Always false until the MFA todo ships (it replaces this). */
function requiresSecondFactor(_user: { id: string }): boolean {
  return false;
}
export const secondFactor = { requiresSecondFactor };

/**
 * The single gate every social sign-in passes BEFORE anything is linked or a
 * session issued. Order: second factor first, then email verification
 * (mirrors /api/auth/login's EMAIL_NOT_VERIFIED).
 */
export function signInGate(
  user: { id: string; emailVerified: boolean },
  opts: { emailWillBeVerified: boolean; verificationOn: boolean },
): GateResult {
  if (secondFactor.requiresSecondFactor(user)) {
    return {
      ok: false,
      status: 403,
      code: ErrorCode.SECOND_FACTOR_REQUIRED,
      message: "Second factor required",
    };
  }
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
