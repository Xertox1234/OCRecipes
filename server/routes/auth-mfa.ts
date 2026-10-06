import type { Express, Request, Response } from "express";
import type { ZodError } from "zod";
import { storage } from "../storage";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { handleRouteError, formatZodError } from "./_helpers";
import {
  mfaVerifySchema,
  mfaSetupSchema,
  mfaConfirmSchema,
  mfaDisableSchema,
  mfaRecoveryCodesSchema,
} from "./_schemas";
import { mfaVerifyLimiter, reauthLimiter } from "./_rate-limiters";
import { fireAndForget } from "../lib/fire-and-forget";
import { isUniqueViolation } from "../lib/db-errors";
import { sendTwoFactorNotice } from "../services/email";
import {
  decryptMfaSecret,
  encryptMfaSecret,
  generateRecoveryCodes,
  hashChallengeToken,
  hashRecoveryCode,
  mfaConfigured,
  newTotpSecret,
} from "../lib/mfa/mfa-secrets";
import { base32Decode, matchTotp, otpauthUrl } from "../lib/mfa/totp";
import { verifySecondFactor } from "../lib/mfa/verify-second-factor";
import { issueSession } from "../lib/mfa/begin-session";
import {
  requireAuth,
  invalidateTokenVersionCache,
  type AuthenticatedRequest,
} from "../middleware/auth";
import { reauthenticate } from "./auth-social";

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

function badRequest(res: Response, error: ZodError) {
  sendError(res, 400, formatZodError(error), ErrorCode.VALIDATION_ERROR);
}

function reauthFailed(res: Response) {
  sendError(
    res,
    401,
    "That didn't match. Please try again.",
    ErrorCode.UNAUTHORIZED,
  );
}

function codeInvalid(res: Response, status: 400 | 401) {
  sendError(
    res,
    status,
    "That code didn't work. Check your authenticator app and try again.",
    ErrorCode.MFA_CODE_INVALID,
  );
}

function locked(res: Response) {
  sendError(
    res,
    429,
    "Too many wrong codes. Try again in 15 minutes.",
    ErrorCode.MFA_LOCKED,
  );
}

const hashAll = (userId: string, codes: string[]) =>
  codes.map((c) => hashRecoveryCode(userId, c.replace(/-/g, "")));

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

  // Start setup: confirm it's you, then a candidate secret (10 minutes).
  app.post(
    "/api/auth/mfa/totp/setup",
    requireAuth,
    reauthLimiter,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const parsed = mfaSetupSchema.safeParse(req.body);
        if (!parsed.success) return badRequest(res, parsed.error);
        if (!mfaConfigured()) {
          return sendError(
            res,
            503,
            "Two-step verification isn't available right now.",
            ErrorCode.MFA_UNAVAILABLE,
          );
        }
        const me = await storage.getUserForAuth(req.userId);
        if (!me) return reauthFailed(res);
        if (me.mfaEnabledAt) {
          return sendError(
            res,
            409,
            "Two-step verification is already on.",
            ErrorCode.MFA_ALREADY_ENABLED,
          );
        }
        if (!(await reauthenticate(me.id, me.password, parsed.data.proof))) {
          return reauthFailed(res);
        }
        const secret = newTotpSecret();
        await storage.startTotpEnrollment(me.id, encryptMfaSecret(secret));
        res.json({ secret, otpauthUrl: otpauthUrl(secret, me.username) });
      } catch (error) {
        handleRouteError(res, error, "start two-step setup");
      }
    },
  );

  // Finish setup with the first code from the app: 2FA on, other devices
  // signed out, this device gets a fresh token, recovery codes shown once.
  app.post(
    "/api/auth/mfa/totp/confirm",
    requireAuth,
    mfaVerifyLimiter,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const parsed = mfaConfirmSchema.safeParse(req.body);
        if (!parsed.success) return badRequest(res, parsed.error);
        const pending = await storage.getPendingTotpSecret(req.userId);
        if (!pending) return codeInvalid(res, 400);
        const step = matchTotp(
          base32Decode(decryptMfaSecret(pending)),
          parsed.data.code,
          Date.now(),
        );
        if (step === null) return codeInvalid(res, 400);

        const recoveryCodes = generateRecoveryCodes();
        const version = await storage.confirmTotpEnrollment(req.userId, {
          acceptedStep: step,
          recoveryHashes: hashAll(req.userId, recoveryCodes),
        });
        if (version === undefined) {
          return sendError(
            res,
            409,
            "Two-step verification is already on.",
            ErrorCode.MFA_ALREADY_ENABLED,
          );
        }
        invalidateTokenVersionCache(req.userId);
        const session = await issueSession(req.userId);
        if (!session) return reauthFailed(res);
        fireAndForget(
          "mfa-enabled-notice",
          sendTwoFactorNotice(
            session.user.email,
            session.user.username,
            "enabled",
          ),
        );
        res.json({ ...session, recoveryCodes });
      } catch (error) {
        handleRouteError(res, error, "finish two-step setup");
      }
    },
  );

  // Turn 2FA off: re-auth AND a second factor.
  app.post(
    "/api/auth/mfa/disable",
    requireAuth,
    reauthLimiter,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const parsed = mfaDisableSchema.safeParse(req.body);
        if (!parsed.success) return badRequest(res, parsed.error);
        const { proof, ...second } = parsed.data;
        const me = await storage.getUserForAuth(req.userId);
        if (!me) return reauthFailed(res);
        if (!me.mfaEnabledAt) {
          return sendError(
            res,
            409,
            "Two-step verification is already off.",
            ErrorCode.MFA_NOT_ENABLED,
          );
        }
        if (!(await reauthenticate(me.id, me.password, proof))) {
          return reauthFailed(res);
        }
        const result = await verifySecondFactor(me.id, second);
        if (!result.ok) {
          return result.reason === "locked"
            ? locked(res)
            : codeInvalid(res, 401);
        }
        await storage.disableMfa(me.id);
        invalidateTokenVersionCache(me.id);
        const session = await issueSession(me.id);
        if (!session) return reauthFailed(res);
        fireAndForget(
          "mfa-disabled-notice",
          sendTwoFactorNotice(me.email, me.username, "disabled"),
        );
        res.json(session);
      } catch (error) {
        handleRouteError(res, error, "turn off two-step verification");
      }
    },
  );

  // New recovery codes: re-auth AND a current app code; the old set stops working.
  app.post(
    "/api/auth/mfa/recovery-codes",
    requireAuth,
    reauthLimiter,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const parsed = mfaRecoveryCodesSchema.safeParse(req.body);
        if (!parsed.success) return badRequest(res, parsed.error);
        const me = await storage.getUserForAuth(req.userId);
        if (!me) return reauthFailed(res);
        if (!me.mfaEnabledAt) {
          return sendError(
            res,
            409,
            "Two-step verification is off.",
            ErrorCode.MFA_NOT_ENABLED,
          );
        }
        if (!(await reauthenticate(me.id, me.password, parsed.data.proof))) {
          return reauthFailed(res);
        }
        const result = await verifySecondFactor(me.id, {
          code: parsed.data.code,
        });
        if (!result.ok) {
          return result.reason === "locked"
            ? locked(res)
            : codeInvalid(res, 401);
        }
        const recoveryCodes = generateRecoveryCodes();
        await storage.replaceRecoveryCodes(
          me.id,
          hashAll(me.id, recoveryCodes),
        );
        fireAndForget(
          "mfa-codes-replaced-notice",
          sendTwoFactorNotice(me.email, me.username, "recovery_codes_replaced"),
        );
        res.json({ recoveryCodes });
      } catch (error) {
        handleRouteError(res, error, "replace recovery codes");
      }
    },
  );
}
