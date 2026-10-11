import type { NextFunction, Request, Response } from "express";
import type { User } from "@shared/schema";
import { ErrorCode } from "@shared/constants/error-codes";
import { storage } from "../storage";
import { sendError } from "../lib/api-errors";
import { setRequestUserId } from "../lib/request-context";
import { hashUpgradePassToken } from "../lib/upgrade-pass";
import { createServiceLogger, toError } from "../lib/logger";

const logger = createServiceLogger("upgrade-pass");

const SCHEME = "UpgradePass ";

export const UPGRADE_PASS_EXPIRED_MESSAGE =
  "This sign-in expired. Please sign in again.";

export interface UpgradePassContext {
  idHash: string;
  tokenVersion: number;
  twoStepAllowed: boolean;
  user: User;
}

/** The pass requireUpgradePass accepted. Only call behind that middleware. */
export function upgradePassOf(res: Response): UpgradePassContext {
  return res.locals.upgradePass as UpgradePassContext;
}

/**
 * Accepts ONLY `Authorization: UpgradePass <token>` — a short password's
 * restricted pass (password policy spec §6). A different scheme from
 * requireAuth's Bearer JWT, so neither credential can stand in for the other.
 * The pass must be unspent, unexpired and under its attempt cap, its user
 * must still exist with the same tokenVersion, and still have no two-step.
 */
export async function requireUpgradePass(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const expired = () =>
    sendError(
      res,
      401,
      UPGRADE_PASS_EXPIRED_MESSAGE,
      ErrorCode.UPGRADE_PASS_EXPIRED,
    );
  const header = req.headers.authorization;
  if (!header?.startsWith(SCHEME)) return expired();
  const token = header.slice(SCHEME.length);
  if (token.length < 20 || token.length > 100) return expired();
  try {
    const idHash = hashUpgradePassToken(token);
    const pass = await storage.getLiveUpgradePass(idHash);
    if (!pass) return expired();
    const user = await storage.getUserForAuth(pass.userId);
    if (
      !user ||
      user.tokenVersion !== pass.tokenVersion ||
      user.mfaEnabledAt !== null
    ) {
      return expired();
    }
    req.userId = user.id;
    setRequestUserId(user.id);
    res.locals.upgradePass = {
      idHash,
      tokenVersion: pass.tokenVersion,
      twoStepAllowed: pass.twoStepAllowed,
      user,
    } satisfies UpgradePassContext;
    next();
  } catch (err) {
    logger.error({ err: toError(err) }, "upgrade pass check failed");
    sendError(res, 500, "Something went wrong", ErrorCode.INTERNAL_ERROR);
  }
}
