import { storage } from "../../storage";
import { sha256Hex } from "../social-identity/nonce";
import { hashChallengeToken, newChallengeToken } from "./mfa-secrets";

/**
 * A password check passed on an MFA account. Answered with HTTP 200, never a
 * 4xx: loginAccountLimiter skips successful requests, so a 4xx would count a
 * CORRECT password as a failed login.
 */
export type MfaRequired = { status: "mfa_required"; challenge: string };

/**
 * Open a single-use challenge (an opaque random token, not a JWT — requireAuth
 * can never accept it). Only its hash is stored, bound to the user's current
 * tokenVersion so a password reset or sign-out-everywhere kills it.
 */
export async function startMfaChallenge(input: {
  user: { id: string; tokenVersion: number };
  purpose: "login" | "link";
  link?: { ticket: string; markEmailVerified: boolean; notAfter: Date };
}): Promise<MfaRequired> {
  const challenge = newChallengeToken();
  await storage.createMfaChallenge({
    tokenHash: hashChallengeToken(challenge),
    userId: input.user.id,
    tokenVersion: input.user.tokenVersion,
    purpose: input.purpose,
    linkTicketHash: input.link && sha256Hex(input.link.ticket),
    linkMarkEmailVerified: input.link?.markEmailVerified ?? false,
    notAfter: input.link?.notAfter,
  });
  return { status: "mfa_required", challenge };
}
