import crypto from "node:crypto";
import { storage } from "../storage";
import {
  PASSWORD_MIN_SINGLE_FACTOR,
  PASSWORD_MIN_WITH_MFA,
  passwordLength,
} from "@shared/constants/password-policy";

/**
 * A correct password under 15 on an account without two-step (password
 * policy spec §5.2): a restricted pass, no session. Answered with HTTP 200,
 * like MfaRequired, so loginAccountLimiter never counts a correct password.
 */
export type UpgradeRequired = {
  status: "upgrade_required";
  pass: string;
  canUseTwoStep: boolean;
};

/** An opaque random token, never a JWT: requireAuth can't accept it. */
export function newUpgradePassToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashUpgradePassToken(token: string): string {
  return crypto
    .createHash("sha256")
    .update(`pw-upgrade:${token}`)
    .digest("hex");
}

/** The sign-in gate: no two-step, and a password a single factor can't stand on. */
export function needsPasswordUpgrade(
  user: { mfaEnabledAt: Date | null },
  password: string,
): boolean {
  return (
    user.mfaEnabledAt === null &&
    passwordLength(password) < PASSWORD_MIN_SINGLE_FACTOR
  );
}

/**
 * Mint a pass bound to the account's tokenVersion. Below 8 characters,
 * turning two-step on would still leave the password under the floor, so
 * that pass only offers "choose a longer password".
 */
export async function startUpgradePass(
  user: { id: string; tokenVersion: number },
  password: string,
): Promise<UpgradeRequired> {
  const pass = newUpgradePassToken();
  const canUseTwoStep = passwordLength(password) >= PASSWORD_MIN_WITH_MFA;
  await storage.createUpgradePass({
    idHash: hashUpgradePassToken(pass),
    userId: user.id,
    tokenVersion: user.tokenVersion,
    twoStepAllowed: canUseTwoStep,
  });
  return { status: "upgrade_required", pass, canUseTwoStep };
}
