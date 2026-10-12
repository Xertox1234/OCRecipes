import { ErrorCode } from "@shared/constants/error-codes";
import {
  verifySecondFactor,
  type SecondFactorProof,
} from "./verify-second-factor";

export type PasswordProofGate =
  | { ok: true }
  | { ok: false; status: 401 | 403; code: string; message: string };

export const INVALID_SECOND_FACTOR_MESSAGE =
  "That code didn't work. After several wrong codes, codes pause for 15 minutes.";

/**
 * Spec D2: a signed-in route that takes a PASSWORD as proof of identity also
 * needs the second factor on an MFA account. Call it AFTER the password check
 * succeeds (so SECOND_FACTOR_REQUIRED reveals nothing without the password) and
 * BEFORE any write. A Google/Apple proof never needs it (D1).
 */
export async function secondFactorForPasswordProof(
  user: {
    id: string;
    email: string;
    username: string;
    mfaEnabledAt: Date | null;
  },
  proofIsPassword: boolean,
  secondFactor: SecondFactorProof | undefined,
): Promise<PasswordProofGate> {
  if (!proofIsPassword || user.mfaEnabledAt === null) return { ok: true };
  if (!secondFactor) {
    return {
      ok: false,
      status: 403,
      code: ErrorCode.SECOND_FACTOR_REQUIRED,
      message: "Enter your two-step verification code.",
    };
  }
  const result = await verifySecondFactor(
    { id: user.id, email: user.email, username: user.username },
    secondFactor,
  );
  if (result.ok) return { ok: true };
  return {
    ok: false,
    status: 401,
    code: ErrorCode.INVALID_SECOND_FACTOR,
    message: INVALID_SECOND_FACTOR_MESSAGE,
  };
}
