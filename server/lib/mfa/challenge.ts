import { MFA_EMAIL_CODE_TTL_MINUTES } from "@shared/constants/mfa";
import { storage } from "../../storage";
import { sha256Hex } from "../social-identity/nonce";
import { maskEmail, sendMfaEmailCode } from "./email-code";
import { hashChallengeToken, newChallengeToken } from "./mfa-secrets";

/**
 * A password check passed on an MFA account. Answered with HTTP 200, never a
 * 4xx: loginAccountLimiter skips successful requests, so a 4xx would count a
 * CORRECT password as a failed login. On an email account the code has
 * already gone out; `codeSent` is false when the resend cooldown or the daily
 * limit held it back (the last code may still work).
 */
export type MfaRequired =
  | { status: "mfa_required"; challenge: string; method: "totp" }
  | {
      status: "mfa_required";
      challenge: string;
      method: "email";
      emailHint: string;
      codeSent: boolean;
    };

/**
 * Open a single-use challenge (an opaque random token, not a JWT — requireAuth
 * can never accept it). Only its hash is stored, bound to the user's current
 * tokenVersion so a password reset or sign-out-everywhere kills it. An email
 * challenge lives as long as its code.
 */
export async function startMfaChallenge(input: {
  user: { id: string; tokenVersion: number; email: string };
  purpose: "login" | "link";
  link?: { ticket: string; markEmailVerified: boolean; notAfter: Date };
}): Promise<MfaRequired> {
  const state = await storage.getMfaState(input.user.id);
  const byEmail = state?.method === "email";
  const challenge = newChallengeToken();
  await storage.createMfaChallenge({
    tokenHash: hashChallengeToken(challenge),
    userId: input.user.id,
    tokenVersion: input.user.tokenVersion,
    purpose: input.purpose,
    linkTicketHash: input.link && sha256Hex(input.link.ticket),
    linkMarkEmailVerified: input.link?.markEmailVerified ?? false,
    notAfter: input.link?.notAfter,
    ttlMinutes: byEmail ? MFA_EMAIL_CODE_TTL_MINUTES : undefined,
  });
  if (!byEmail) return { status: "mfa_required", challenge, method: "totp" };
  const sent = await sendMfaEmailCode({
    id: input.user.id,
    email: input.user.email,
  });
  return {
    status: "mfa_required",
    challenge,
    method: "email",
    emailHint: maskEmail(input.user.email),
    codeSent: sent === "issued",
  };
}
