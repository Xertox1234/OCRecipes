import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { invalidateTokenVersionCache } from "../middleware/auth";
import {
  requireUpgradePass,
  upgradePassOf,
  UPGRADE_PASS_EXPIRED_MESSAGE,
} from "../middleware/upgrade-pass";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { PASSWORD_MIN_SINGLE_FACTOR } from "@shared/constants/password-policy";
import { handleRouteError, formatZodError } from "./_helpers";
import { upgradePassLimiter } from "./_rate-limiters";
import { mfaConfirmSchema, upgradePasswordSchema } from "./_schemas";
import { checkNewPassword } from "./_password-rules";
import { hashPassword } from "../lib/password-hash";
import { fireAndForget } from "../lib/fire-and-forget";
import { sendPasswordChangedNotice } from "../services/email";
import {
  checkPendingTotpCode,
  confirmFirstEnrollment,
  stageTotpSecret,
  TotpStateChangedError,
  TotpUnavailableError,
} from "../services/mfa-totp";
import { INVALID_SECOND_FACTOR_MESSAGE } from "../lib/mfa/password-proof-gate";
import { HttpFailure, issueSession } from "./auth-social";

// A short password's way out — password policy spec
// docs/superpowers/specs/2026-10-10-password-policy-design.md §6. Every route
// sits behind the pass, never requireAuth; the IP limiter comes first so
// guesses at the pass itself are counted. Never log a code, secret or password.

const MFA_UNAVAILABLE_MESSAGE =
  "Two-step verification is unavailable right now. Please try again later.";

function expired(res: Response): void {
  sendError(
    res,
    401,
    UPGRADE_PASS_EXPIRED_MESSAGE,
    ErrorCode.UPGRADE_PASS_EXPIRED,
  );
}

/** The two-step choice is closed: flag off, or the sign-in password was under 8. */
function twoStepClosed(res: Response): boolean {
  if (process.env.MFA_SETUP_ENABLED !== "true") {
    sendError(
      res,
      403,
      "Two-step verification isn't available yet.",
      ErrorCode.MFA_SETUP_DISABLED,
    );
    return true;
  }
  if (!upgradePassOf(res).twoStepAllowed) {
    sendError(
      res,
      403,
      "Choose a longer password instead.",
      ErrorCode.UPGRADE_TWO_STEP_NOT_ALLOWED,
    );
    return true;
  }
  return false;
}

function answer(
  res: Response,
  error: unknown,
  label: string,
  recoveryCodes?: string[],
): void {
  // Every HttpFailure here is issueSession refusing (version moved on, or the
  // user is gone): the pass is spent, so the way back is sign-in.
  if (error instanceof HttpFailure && error.status === 401) {
    sendError(
      res,
      401,
      UPGRADE_PASS_EXPIRED_MESSAGE,
      ErrorCode.UPGRADE_PASS_EXPIRED,
      recoveryCodes ? { recoveryCodes } : undefined,
    );
    return;
  }
  if (error instanceof TotpUnavailableError) {
    sendError(res, 503, MFA_UNAVAILABLE_MESSAGE, ErrorCode.MFA_UNAVAILABLE);
    return;
  }
  if (error instanceof TotpStateChangedError) {
    sendError(
      res,
      409,
      "Two-step verification is already on.",
      ErrorCode.MFA_ALREADY_ENABLED,
    );
    return;
  }
  if (error instanceof HttpFailure) {
    sendError(res, error.status, error.message, error.code);
    return;
  }
  handleRouteError(res, error, label);
}

export function register(app: Express): void {
  // Turn two-step on: stage a secret. No password in the body — the pass is
  // the proof the password was just typed correctly.
  app.post(
    "/api/auth/upgrade/totp/setup",
    upgradePassLimiter,
    requireUpgradePass,
    async (_req: Request, res: Response) => {
      try {
        if (twoStepClosed(res)) return;
        res.json(await stageTotpSecret(upgradePassOf(res).user));
      } catch (error) {
        answer(res, error, "start two-step setup at sign-in");
      }
    },
  );

  // Finish: a code from the app. Each try spends one of the pass's 10; success
  // consumes the pass in the enrolment transaction, so a double submit gets 401.
  app.post(
    "/api/auth/upgrade/totp/confirm",
    upgradePassLimiter,
    requireUpgradePass,
    async (req: Request, res: Response) => {
      let recoveryCodes: string[] | undefined;
      try {
        const parsed = mfaConfirmSchema.safeParse(req.body);
        if (!parsed.success) {
          return sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
        }
        if (twoStepClosed(res)) return;
        const ctx = upgradePassOf(res);
        if (!(await storage.reserveUpgradePassAttempt(ctx.idHash))) {
          return expired(res);
        }
        const check = await checkPendingTotpCode(ctx.user, parsed.data.code);
        if (!check.ok) {
          return check.reason === "unavailable"
            ? sendError(
                res,
                503,
                MFA_UNAVAILABLE_MESSAGE,
                ErrorCode.MFA_UNAVAILABLE,
              )
            : sendError(
                res,
                400,
                INVALID_SECOND_FACTOR_MESSAGE,
                ErrorCode.INVALID_SECOND_FACTOR,
              );
        }
        const enrolled = await confirmFirstEnrollment(ctx.user, check.step, {
          upgradePass: { idHash: ctx.idHash, tokenVersion: ctx.tokenVersion },
        });
        if (!enrolled) return expired(res);
        recoveryCodes = enrolled.recoveryCodes;
        invalidateTokenVersionCache(ctx.user.id);
        // Only under the version the enrolment set: a reset or sign-out-
        // everywhere since then wins (auth audit L1, as L12). Two-step is on
        // and the pass spent either way, so the codes ride the refusal too.
        res.json({
          ...(await issueSession(ctx.user.id, enrolled.tokenVersion)),
          recoveryCodes,
        });
      } catch (error) {
        answer(res, error, "confirm two-step setup at sign-in", recoveryCodes);
      }
    },
  );

  // Choose a longer password (15+, not breached). One transaction writes it,
  // consumes the pass, ends every session and forgets trusted phones.
  app.post(
    "/api/auth/upgrade/password",
    upgradePassLimiter,
    requireUpgradePass,
    async (req: Request, res: Response) => {
      try {
        const parsed = upgradePasswordSchema.safeParse(req.body);
        if (!parsed.success) {
          return sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
        }
        const ctx = upgradePassOf(res);
        const rejected = await checkNewPassword(
          parsed.data.newPassword,
          PASSWORD_MIN_SINGLE_FACTOR,
          "single_factor",
        );
        // Answered here, never thrown: the rejection derives from the
        // password, and a thrown value can reach the error logger.
        if (rejected) {
          return sendError(
            res,
            rejected.status,
            rejected.message,
            rejected.code,
          );
        }
        const version = await storage.completePasswordUpgrade({
          idHash: ctx.idHash,
          userId: ctx.user.id,
          tokenVersion: ctx.tokenVersion,
          newPasswordHash: await hashPassword(parsed.data.newPassword),
        });
        if (version === undefined) return expired(res);
        invalidateTokenVersionCache(ctx.user.id);
        fireAndForget(
          "password-changed-notice",
          sendPasswordChangedNotice(ctx.user.email, ctx.user.username),
        );
        res.json(await issueSession(ctx.user.id, version));
      } catch (error) {
        answer(res, error, "set a longer password at sign-in");
      }
    },
  );
}
