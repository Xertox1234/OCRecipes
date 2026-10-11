import type { Express, Response } from "express";
import { storage } from "../storage";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { fireAndForget } from "../lib/fire-and-forget";
import { handleRouteError } from "./_helpers";
import { changePasswordCodeLimiter } from "./_rate-limiters";
import { generateResetCode, hashChangeCode } from "../lib/password-reset-code";
import { sendPasswordChangeCode } from "../services/email";

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
}
