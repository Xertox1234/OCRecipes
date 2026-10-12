import { storage } from "../../storage";
import { sendTwoFactorNotice } from "../../services/email";
import { fireAndForget } from "../fire-and-forget";
import { signInCodeMatches } from "../password-reset-code";

/** The emailed 6-digit code (the only second factor — owner ruling 4). */
export type SecondFactorProof = { code: string };
export type SecondFactorResult = { ok: true } | { ok: false };

const INVALID = { ok: false } as const;

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
 * Check the code from the latest two-step email for an account with two-step
 * on. A lock refuses without counting (one generic answer). There is no hard
 * failure cap: the every-10th lock plus 5 guesses per code and 10 codes a day
 * bound guessing. Never logs the code.
 */
export async function verifySecondFactor(
  user: NoticeUser,
  proof: SecondFactorProof,
): Promise<SecondFactorResult> {
  const state = await storage.getMfaState(user.id);
  if (!state || state.locked) return INVALID;
  const stored = await storage.reserveMfaEmailAttempt(user.id);
  if (!stored || !signInCodeMatches(user.id, proof.code, stored))
    return fail(user);
  if (!(await storage.acceptMfaEmailCode(user.id, stored))) return fail(user);
  return { ok: true };
}
