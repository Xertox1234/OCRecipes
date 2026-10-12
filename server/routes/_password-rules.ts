import { ErrorCode } from "@shared/constants/error-codes";
import {
  newPasswordProblem,
  passwordMessage,
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
 * The new-password check: length (8 for everyone), then the breach check
 * (fail open). null = acceptable.
 */
export async function checkNewPassword(
  pw: string,
): Promise<PasswordRejection | null> {
  const problem = newPasswordProblem(pw);
  if (problem) {
    return {
      status: 400,
      code: ErrorCode.PASSWORD_TOO_SHORT,
      message: passwordMessage(problem),
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
