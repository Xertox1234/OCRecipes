import { ErrorCode } from "@shared/constants/error-codes";
import {
  newPasswordProblem,
  passwordMessage,
  type PasswordContext,
} from "@shared/constants/password-policy";
import { isBreached } from "../lib/pwned-password";

export interface PasswordRejection {
  status: 400;
  code:
    | typeof ErrorCode.PASSWORD_TOO_SHORT
    | typeof ErrorCode.PASSWORD_BREACHED;
  message: string;
}

/**
 * The state-dependent new-password check (spec §2, P2): length for the
 * account's minimum, then the breach check (fail open). null = acceptable.
 */
export async function checkNewPassword(
  pw: string,
  min: number,
  context: PasswordContext,
): Promise<PasswordRejection | null> {
  const problem = newPasswordProblem(pw, { min });
  if (problem) {
    return {
      status: 400,
      code: ErrorCode.PASSWORD_TOO_SHORT,
      message: passwordMessage(problem, context),
    };
  }
  if ((await isBreached(pw)) === true) {
    return {
      status: 400,
      code: ErrorCode.PASSWORD_BREACHED,
      message:
        "That password has appeared in a data breach. Choose a different one.",
    };
  }
  return null;
}
