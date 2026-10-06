import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { handleRouteError, formatZodError } from "./_helpers";
import { mfaVerifySchema } from "./_schemas";
import { mfaVerifyLimiter } from "./_rate-limiters";
import { fireAndForget } from "../lib/fire-and-forget";
import { isUniqueViolation } from "../lib/db-errors";
import { sendTwoFactorNotice } from "../services/email";
import { hashChallengeToken } from "../lib/mfa/mfa-secrets";
import { verifySecondFactor } from "../lib/mfa/verify-second-factor";
import { issueSession } from "../lib/mfa/begin-session";

// Two-step verification routes — plan
// docs/superpowers/plans/2026-10-05-totp-second-factor.md. Never log a code,
// a recovery code or a challenge.

function challengeInvalid(res: Response) {
  sendError(
    res,
    401,
    "This sign-in expired. Please sign in again.",
    ErrorCode.MFA_CHALLENGE_INVALID,
  );
}

export function register(app: Express): void {
  // Finish a sign-in that beginSession challenged.
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
        const { challenge, ...proof } = parsed.data;
        const tokenHash = hashChallengeToken(challenge);

        const row = await storage.reserveMfaChallengeAttempt(tokenHash);
        if (!row) return challengeInvalid(res);

        // A password reset or sign-out-everywhere since the challenge opened
        // moved token_version: the challenge dies with the old sessions.
        const user = await storage.getUserForAuth(row.userId);
        if (!user || user.tokenVersion !== row.tokenVersion) {
          await storage.consumeMfaChallenge(tokenHash);
          return challengeInvalid(res);
        }

        const result = await verifySecondFactor(user.id, proof);
        if (!result.ok) {
          if (result.reason === "locked") {
            return sendError(
              res,
              429,
              "Too many wrong codes. Try again in 15 minutes.",
              ErrorCode.MFA_LOCKED,
            );
          }
          return sendError(
            res,
            401,
            "That code didn't work. Check your authenticator app and try again.",
            ErrorCode.MFA_CODE_INVALID,
          );
        }

        // Single use: a concurrent request that also passed loses here.
        if (!(await storage.consumeMfaChallenge(tokenHash))) {
          return challengeInvalid(res);
        }

        if (row.purpose === "link") {
          let identity;
          try {
            identity = await storage.completeLinkByTicketHash(
              row.linkTicketHash ?? "",
              {
                markEmailVerified: row.linkMarkEmailVerified,
                targetUserId: user.id,
              },
            );
          } catch (err) {
            if (isUniqueViolation(err)) {
              return sendError(
                res,
                409,
                "This account is already connected.",
                ErrorCode.IDENTITY_IN_USE,
              );
            }
            throw err;
          }
          if (!identity) return challengeInvalid(res);
        }

        const session = await issueSession(user.id);
        if (!session) return challengeInvalid(res);

        if (result.usedRecoveryCode) {
          fireAndForget(
            "mfa-recovery-code-notice",
            sendTwoFactorNotice(
              user.email,
              user.username,
              "recovery_code_used",
            ),
          );
          return res.json({
            ...session,
            replacementRecoveryCode: result.replacementRecoveryCode,
          });
        }
        res.json(session);
      } catch (error) {
        handleRouteError(res, error, "verify sign-in code");
      }
    },
  );
}
