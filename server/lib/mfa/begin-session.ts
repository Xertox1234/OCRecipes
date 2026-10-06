import type { User } from "@shared/schema";
import { storage } from "../../storage";
import { generateToken } from "../../middleware/auth";
import { serializeUser } from "../../routes/_serialize-user";
import { secondFactor } from "../social-identity/sign-in-gates";
import { sha256Hex } from "../social-identity/nonce";
import { hashChallengeToken, newChallengeToken } from "./mfa-secrets";

export type SignedIn = {
  status: "signed_in";
  user: ReturnType<typeof serializeUser>;
  token: string;
};
export type MfaRequired = { status: "mfa_required"; challenge: string };

function mintSession(user: User): SignedIn {
  return {
    status: "signed_in",
    user: serializeUser(user),
    token: generateToken(user.id, user.tokenVersion, user.emailVerified),
  };
}

/**
 * Mint a session from a fresh read of the account; null when it no longer
 * exists. Never gated — its callers are.
 */
export async function issueSession(userId: string): Promise<SignedIn | null> {
  const user = await storage.getUser(userId);
  return user ? mintSession(user) : null;
}

/**
 * THE gate: every session for an EXISTING account goes through here (password
 * login, Google/Apple sign-in, linking a provider). A brand-new account has no
 * second factor and may call issueSession directly.
 *
 * - 2FA off: run `beforeSession` (writes that must not happen for a challenged
 *   sign-in), complete the `link` if any, then mint. Returns null only on the
 *   link path, when the ticket (or the account) is gone — the caller answers
 *   with its own "expired" error.
 * - 2FA on: open a challenge and return it. NOTHING else is written — no
 *   identity linked, no provider token stored, no session.
 */
export async function beginSession(
  user: User,
  opts: {
    link?: { ticket: string; markEmailVerified: boolean };
    beforeSession?: () => Promise<void>;
  } = {},
): Promise<SignedIn | MfaRequired | null> {
  if (secondFactor.requiresSecondFactor(user)) {
    const challenge = newChallengeToken();
    await storage.createMfaChallenge({
      tokenHash: hashChallengeToken(challenge),
      userId: user.id,
      tokenVersion: user.tokenVersion,
      purpose: opts.link ? "link" : "login",
      ...(opts.link && {
        linkTicketHash: sha256Hex(opts.link.ticket),
        linkMarkEmailVerified: opts.link.markEmailVerified,
      }),
    });
    return { status: "mfa_required", challenge };
  }

  await opts.beforeSession?.();
  if (opts.link) {
    const identity = await storage.completeLinkFromTicket(opts.link.ticket, {
      markEmailVerified: opts.link.markEmailVerified,
    });
    if (!identity) return null;
    // Linking can verify the email — mint from the account as it is now.
    return issueSession(user.id);
  }
  return mintSession(user);
}
