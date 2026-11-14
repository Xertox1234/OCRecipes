import { ErrorCode } from "@shared/constants/error-codes";
import { storage } from "../storage";
import type { ProviderName } from "../storage";
import { generateToken } from "../middleware/auth";
import type { ReauthProof } from "../routes/_schemas";
import { serializeUser } from "../lib/serialize-user";
import { passwordMatches } from "../lib/password-check";
import { getSocialConfig } from "../lib/social-identity/config";
import {
  verifyGoogleIdToken,
  verifyAppleIdToken,
  TokenVerificationError,
} from "../lib/social-identity/verify";
import {
  exchangeAppleCode,
  revokeAppleToken,
} from "../lib/social-identity/apple-tokens";
import {
  encryptToken,
  decryptToken,
} from "../lib/social-identity/token-crypto";
import { reportError } from "../lib/error-reporter";
import type { ProviderClaims } from "../lib/social-identity/types";
import { createServiceLogger, toError } from "../lib/logger";

/**
 * Session issuance, re-auth and Apple token handling shared by the auth
 * routes (auth.ts, auth-social.ts, auth-password.ts, auth-mfa.ts). Moved out
 * of routes/auth-social.ts (architecture audit 2026-11-06 M1) so no route
 * module imports another for them. Bodies unchanged.
 */

const logger = createServiceLogger("auth-session");

export class HttpFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

/**
 * "Name: message" for each error in `err`'s cause chain — for logs only.
 * Provider/jose error messages carry no token material.
 */
function describeCauses(err: unknown): string | undefined {
  const parts: string[] = [];
  let cur: unknown = err instanceof Error ? err.cause : undefined;
  while (cur instanceof Error && parts.length < 5) {
    parts.push(`${cur.name}: ${cur.message}`);
    cur = cur.cause;
  }
  return parts.length > 0 ? parts.join(" <- ") : undefined;
}

/** Verify a provider token for a configured provider. Throws HttpFailure. */
export async function verifyProviderToken(
  provider: ProviderName,
  idToken: string,
  nonce: string,
): Promise<ProviderClaims> {
  const cfg = getSocialConfig();
  try {
    if (provider === "google") {
      if (!cfg.google)
        throw new HttpFailure(
          404,
          ErrorCode.PROVIDER_NOT_CONFIGURED,
          "Sign-in provider not available",
        );
      return await verifyGoogleIdToken(idToken, nonce, cfg.google);
    }
    if (!cfg.apple)
      throw new HttpFailure(
        404,
        ErrorCode.PROVIDER_NOT_CONFIGURED,
        "Sign-in provider not available",
      );
    return await verifyAppleIdToken(idToken, nonce, cfg.apple);
  } catch (err) {
    if (err instanceof TokenVerificationError) {
      throw new HttpFailure(
        401,
        ErrorCode.INVALID_PROVIDER_TOKEN,
        "Sign-in could not be verified",
        { cause: err },
      );
    }
    throw err;
  }
}

/** Exchange Apple's one-time code and return the ENCRYPTED refresh token. Throws HttpFailure. */
export async function appleRefreshTokenFor(
  code: string | undefined,
): Promise<string> {
  const cfg = getSocialConfig().apple;
  if (!cfg || !code) {
    throw new HttpFailure(
      502,
      ErrorCode.PROVIDER_EXCHANGE_FAILED,
      "Apple sign-in could not be completed. Please try again.",
    );
  }
  try {
    return encryptToken(await exchangeAppleCode(code, cfg));
  } catch (err) {
    logger.warn({ err: toError(err) }, "apple code exchange failed");
    throw new HttpFailure(
      502,
      ErrorCode.PROVIDER_EXCHANGE_FAILED,
      "Apple sign-in could not be completed. Please try again.",
    );
  }
}

/**
 * `expectedTokenVersion` — the version the caller checked or its own write
 * set: refuse to mint if a reset or sign-out-everywhere bumped it since —
 * checked on the same read the token is minted from, so the session can never
 * outlive that bump (audit L12). Required, so a new mint site can't skip it
 * (audits L1/L3 found the gap one call site at a time).
 */
export async function issueSession(
  userId: string,
  expectedTokenVersion: number,
) {
  const user = await storage.getUser(userId);
  if (!user)
    throw new HttpFailure(401, ErrorCode.UNAUTHORIZED, "User not found");
  if (user.tokenVersion !== expectedTokenVersion)
    throw new HttpFailure(
      401,
      ErrorCode.MFA_CHALLENGE_EXPIRED,
      "This sign-in expired. Please start again.",
    );
  return {
    status: "signed_in" as const,
    user: serializeUser(user),
    token: generateToken(user.id, user.tokenVersion, user.emailVerified),
  };
}

/**
 * Re-auth for sensitive account actions (delete account, connect a sign-in
 * method). A password must match (NULL never does); a provider token must
 * verify, burn a `reauth` nonce bound to `userId`, and belong to an identity
 * ALREADY linked to this account. Any failure is just `false` — callers answer
 * with one generic 401.
 */
export async function reauthenticate(
  userId: string,
  passwordHash: string | null,
  proof: ReauthProof,
): Promise<boolean> {
  if ("password" in proof) return passwordMatches(proof.password, passwordHash);
  let claims: ProviderClaims;
  try {
    claims = await verifyProviderToken(
      proof.provider,
      proof.idToken,
      proof.nonce,
    );
  } catch (err) {
    // Still one generic false. The cause chain (TokenVerificationError <- the
    // jose / JWKS-fetch error) tells a provider outage apart from a bad token.
    // Never log the token itself.
    logger.warn(
      {
        err: toError(err),
        cause: describeCauses(err),
        provider: proof.provider,
      },
      "reauth provider token verification failed",
    );
    return false;
  }
  const nonceOk = await storage.consumeNonce(proof.nonce, "reauth", userId);
  const owned = await storage.findIdentity(claims.provider, claims.sub);
  return nonceOk && owned !== undefined && owned.userId === userId;
}

/** Best-effort: never throws. Used by disconnect and account deletion. */
export async function revokeAppleIdentities(
  identities: { provider: string; appleRefreshTokenEnc: string | null }[],
): Promise<void> {
  const cfg = getSocialConfig().apple;
  for (const i of identities) {
    if (i.provider !== "apple" || !i.appleRefreshTokenEnc) continue;
    try {
      if (!cfg) throw new Error("Apple not configured; cannot revoke");
      await revokeAppleToken(decryptToken(i.appleRefreshTokenEnc), cfg);
    } catch (err) {
      const error = toError(err);
      logger.error({ err: error }, "apple token revoke failed");
      reportError(error, "apple-token-revoke");
    }
  }
}
