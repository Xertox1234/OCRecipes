import type { Express, Response } from "express";
import { storage } from "../storage";
import {
  requireAuth,
  invalidateTokenVersionCache,
  type AuthenticatedRequest,
} from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { fireAndForget } from "../lib/fire-and-forget";
import {
  PASSWORD_MIN_SINGLE_FACTOR,
  PASSWORD_MIN_WITH_MFA,
} from "@shared/constants/password-policy";
import { handleRouteError, formatZodError } from "./_helpers";
import { changePasswordCodeLimiter, reauthLimiter } from "./_rate-limiters";
import { changePasswordSchema } from "./_schemas";
import { checkNewPassword } from "./_password-rules";
import { reauthenticate, issueSession, HttpFailure } from "./auth-social";
import { secondFactorForPasswordProof } from "../lib/mfa/password-proof-gate";
import { hashPassword } from "../lib/password-hash";
import {
  changeCodeMatches,
  generateResetCode,
  hashChangeCode,
} from "../lib/password-reset-code";
import {
  sendPasswordChangeCode,
  sendPasswordChangedNotice,
} from "../services/email";

export const CODE_LIMIT_MESSAGE =
  "You've requested too many codes today. Try again tomorrow, or use Google/Apple.";

// Signed-in password change (change-password spec, 2026-10-11): a person who
// can prove who they are another way can always set a new password, and a
// stranger who knows only the email can't block it (auth audit L5).
export function register(app: Express): void {
  // Email a code to the account's CURRENT address (never pendingEmail).
  app.post(
    "/api/auth/change-password/code",
    requireAuth,
    changePasswordCodeLimiter,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const user = await storage.getUserForAuth(req.userId);
        if (!user) {
          return sendError(res, 404, "User not found", ErrorCode.NOT_FOUND);
        }
        const code = generateResetCode();
        if (
          !(await storage.issuePasswordChangeCode(
            user.id,
            hashChangeCode(user.id, code),
          ))
        ) {
          return sendError(
            res,
            429,
            CODE_LIMIT_MESSAGE,
            ErrorCode.RATE_LIMITED,
          );
        }
        fireAndForget(
          "password-change-code",
          sendPasswordChangeCode(user.email, code),
        );
        res.json({ status: "code_sent" });
      } catch (error) {
        handleRouteError(res, error, "send password change code");
      }
    },
  );

  // Set a new password, proven by the current password, a fresh Google/Apple
  // confirmation, or the emailed code (spec §4.1 order: proof → second factor
  // → policy → one pinned commit → session).
  app.post(
    "/api/auth/change-password",
    requireAuth,
    reauthLimiter,
    async (req: AuthenticatedRequest, res: Response) => {
      // Once a recovery code is spent, every answer carries its replacement.
      let replacement: { replacementRecoveryCode?: string } = {};
      try {
        const parsed = changePasswordSchema.safeParse(req.body);
        if (!parsed.success) {
          return sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
        }
        const { proof, newPassword } = parsed.data;
        const user = await storage.getUserForAuth(req.userId);
        if (!user) {
          return sendError(res, 404, "User not found", ErrorCode.NOT_FOUND);
        }

        let consumeCodeHash: string | undefined;
        if ("emailCode" in proof) {
          const stored = await storage.reservePasswordChangeAttempt(user.id);
          if (!stored || !changeCodeMatches(user.id, proof.emailCode, stored)) {
            return sendError(
              res,
              400,
              "That code didn't work. Request a new one.",
              ErrorCode.INVALID_RESET_CODE,
            );
          }
          consumeCodeHash = stored;
        } else if (!(await reauthenticate(user.id, user.password, proof))) {
          return sendError(
            res,
            401,
            "That didn't match. Try again.",
            ErrorCode.UNAUTHORIZED,
          );
        }

        // An emailed code is one factor, like a password: on a two-step
        // account it also needs the code (2FA spec D2). Only a Google/Apple
        // confirmation is exempt (D1).
        const singleFactor = "password" in proof || "emailCode" in proof;
        const gate = await secondFactorForPasswordProof(
          user,
          singleFactor,
          "provider" in proof ? undefined : proof.secondFactor,
        );
        if (!gate.ok)
          return sendError(res, gate.status, gate.message, gate.code);
        if (gate.replacementRecoveryCode) {
          replacement = {
            replacementRecoveryCode: gate.replacementRecoveryCode,
          };
        }

        const mfa = user.mfaEnabledAt !== null;
        const rejected = await checkNewPassword(
          newPassword,
          mfa ? PASSWORD_MIN_WITH_MFA : PASSWORD_MIN_SINGLE_FACTOR,
          mfa ? "mfa" : "single_factor",
        );
        if (rejected) {
          return sendError(
            res,
            rejected.status,
            rejected.message,
            rejected.code,
            replacement,
          );
        }

        const newVersion = await storage.changePassword({
          userId: user.id,
          expectedTokenVersion: user.tokenVersion,
          newPasswordHash: await hashPassword(newPassword),
          consumeCodeHash,
        });
        if (newVersion === undefined) {
          return sendError(
            res,
            401,
            "Please sign in again.",
            "TOKEN_REVOKED",
            replacement,
          );
        }
        invalidateTokenVersionCache(user.id);
        fireAndForget(
          "password-changed-notice",
          (async () => {
            // A failed lookup must not cost the notice itself.
            const ids = await storage.listIdentities(user.id).catch(() => []);
            await sendPasswordChangedNotice(
              user.email,
              user.username,
              ids.map((i) => i.provider),
            );
          })(),
        );
        const session = await issueSession(user.id, newVersion);
        res.json({ ...session, ...replacement });
      } catch (error) {
        if (error instanceof HttpFailure && error.status === 401) {
          return sendError(
            res,
            401,
            "Please sign in again.",
            "TOKEN_REVOKED",
            replacement,
          );
        }
        handleRouteError(res, error, "change password", replacement);
      }
    },
  );
}
