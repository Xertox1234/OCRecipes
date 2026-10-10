import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { handleRouteError, formatZodError } from "./_helpers";
import { mfaVerifyLimiter } from "./_rate-limiters";
import { mfaVerifySchema } from "./_schemas";
import { isUniqueViolation } from "../lib/db-errors";
import {
  hashChallengeToken,
  hashTrustKey,
  newTrustKey,
} from "../lib/mfa/mfa-secrets";
import { verifySecondFactor } from "../lib/mfa/verify-second-factor";
import { INVALID_SECOND_FACTOR_MESSAGE } from "../lib/mfa/password-proof-gate";
import { HttpFailure, issueSession } from "./auth-social";

// Two-step verification — spec docs/superpowers/specs/2026-10-10-totp-second-factor-design.md.
// Never log a code, recovery code, challenge, trust key or secret.

const CHALLENGE_EXPIRED = "This sign-in expired. Please start again.";
const MFA_UNAVAILABLE_MESSAGE =
  "Two-step verification is unavailable right now. Please try again later.";

export function register(app: Express): void {
  // Answer a challenge from a password sign-in or the Connect prompt. No
  // requireAuth: the challenge itself is the (single-use) credential.
  app.post(
    "/api/auth/mfa/verify",
    mfaVerifyLimiter,
    async (req: Request, res: Response) => {
      try {
        const parsed = mfaVerifySchema.safeParse(req.body);
        if (!parsed.success) {
          return sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
        }
        const { challenge, secondFactor, trustDevice } = parsed.data;
        const tokenHash = hashChallengeToken(challenge);

        const row = await storage.reserveMfaChallengeAttempt(tokenHash);
        if (!row) {
          return sendError(
            res,
            401,
            CHALLENGE_EXPIRED,
            ErrorCode.MFA_CHALLENGE_EXPIRED,
          );
        }
        // A password reset or sign-out-everywhere since the challenge was
        // opened bumped tokenVersion: the challenge is dead.
        const user = await storage.getUserForAuth(row.userId);
        if (!user || user.tokenVersion !== row.tokenVersion) {
          await storage.consumeMfaChallenge(tokenHash);
          return sendError(
            res,
            401,
            CHALLENGE_EXPIRED,
            ErrorCode.MFA_CHALLENGE_EXPIRED,
          );
        }

        const r = await verifySecondFactor(user, secondFactor);
        if (!r.ok) {
          return r.reason === "unavailable"
            ? sendError(
                res,
                503,
                MFA_UNAVAILABLE_MESSAGE,
                ErrorCode.MFA_UNAVAILABLE,
              )
            : sendError(
                res,
                401,
                INVALID_SECOND_FACTOR_MESSAGE,
                ErrorCode.INVALID_SECOND_FACTOR,
              );
        }

        // From here a spent recovery code is gone, so EVERY answer — success
        // or failure — hands back its replacement.
        const replacement = r.replacementRecoveryCode
          ? { replacementRecoveryCode: r.replacementRecoveryCode }
          : {};
        const fail = (status: number, code: string, error: string) =>
          res.status(status).json({ error, code, ...replacement });

        if (!(await storage.consumeMfaChallenge(tokenHash))) {
          return fail(401, ErrorCode.MFA_CHALLENGE_EXPIRED, CHALLENGE_EXPIRED);
        }

        if (row.purpose === "link") {
          let identity;
          try {
            identity = await storage.completeLinkByTicketHash(
              row.linkTicketHash!,
              { markEmailVerified: row.linkMarkEmailVerified },
            );
          } catch (err) {
            if (isUniqueViolation(err)) {
              return fail(
                409,
                ErrorCode.IDENTITY_IN_USE,
                "This account is already connected.",
              );
            }
            throw err;
          }
          if (!identity) {
            return fail(
              401,
              ErrorCode.INVALID_SIGN_IN_TICKET,
              "This sign-in has expired. Please start again.",
            );
          }
        }

        let session;
        try {
          session = await issueSession(user.id);
        } catch (err) {
          if (err instanceof HttpFailure)
            return fail(err.status, err.code, err.message);
          throw err;
        }
        const trustKey =
          row.purpose === "login" && trustDevice ? newTrustKey() : undefined;
        if (trustKey)
          await storage.trustDevice(user.id, hashTrustKey(trustKey));
        res.json({
          ...session,
          ...(trustKey ? { trustKey } : {}),
          ...replacement,
        });
      } catch (error) {
        handleRouteError(res, error, "verify second factor");
      }
    },
  );
}
