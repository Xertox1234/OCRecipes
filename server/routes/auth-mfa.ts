import type { Express, Request, Response } from "express";
import { storage, TokenVersionChangedError } from "../storage";
import type { User } from "@shared/schema";
import type { z } from "zod";
import {
  requireAuth,
  invalidateTokenVersionCache,
  type AuthenticatedRequest,
} from "../middleware/auth";
import { sendTwoFactorNotice } from "../services/email";
import { fireAndForget } from "../lib/fire-and-forget";
import { passwordMatches } from "../lib/password-check";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { handleRouteError, formatZodError } from "./_helpers";
import {
  mfaEmailSendLimiter,
  mfaVerifyLimiter,
  reauthLimiter,
} from "./_rate-limiters";
import {
  mfaConfirmSchema,
  mfaDisableSchema,
  mfaEmailResendSchema,
  mfaPasswordSchema,
  mfaVerifySchema,
} from "./_schemas";
import { isUniqueViolation } from "../lib/db-errors";
import {
  hashChallengeToken,
  hashTrustKey,
  newTrustKey,
} from "../lib/mfa/mfa-secrets";
import { verifySecondFactor } from "../lib/mfa/verify-second-factor";
import { INVALID_SECOND_FACTOR_MESSAGE } from "../lib/mfa/password-proof-gate";
import { HttpFailure, issueSession } from "./auth-social";
import { emailVerificationEnabled } from "../lib/email-config";
import { maskEmail, sendMfaEmailCode } from "../lib/mfa/email-code";
import { signInCodeMatches } from "../lib/password-reset-code";

// Two-step verification by emailed code (owner ruling 4, 2026-10-12) — spec
// docs/superpowers/specs/2026-10-10-totp-second-factor-design.md, authenticator
// apps and recovery codes since removed. Never log a code, challenge or trust key.

const CHALLENGE_EXPIRED = "This sign-in expired. Please start again.";
const MFA_UNAVAILABLE_MESSAGE =
  "Two-step verification is unavailable right now. Please try again later.";

/** Thrown to answer a request early; caught once per handler. */
class Reply extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function notice(user: User, kind: Parameters<typeof sendTwoFactorNotice>[2]) {
  fireAndForget(
    "mfa-notice",
    sendTwoFactorNotice(user.email, user.username, kind),
  );
}

/** The signed-in user WITH the password hash; 404 when gone. */
async function me(req: AuthenticatedRequest): Promise<User> {
  const user = await storage.getUserForAuth(req.userId);
  if (!user) throw new Reply(404, ErrorCode.NOT_FOUND, "User not found");
  return user;
}

async function requirePassword(user: User, password: string): Promise<void> {
  // A Google/Apple-only account's NULL password never matches.
  if (!(await passwordMatches(password, user.password))) {
    throw new Reply(401, ErrorCode.UNAUTHORIZED, "Invalid credentials");
  }
}

function requireEnabled(user: User): void {
  if (user.mfaEnabledAt === null) {
    throw new Reply(
      409,
      ErrorCode.MFA_NOT_ENABLED,
      "Two-step verification is off.",
    );
  }
}

/** The code from the latest two-step email. */
async function requireFactor(
  user: User,
  secondFactor: { code: string },
): Promise<void> {
  const r = await verifySecondFactor(user, secondFactor);
  if (r.ok) return;
  throw new Reply(
    401,
    ErrorCode.INVALID_SECOND_FACTOR,
    INVALID_SECOND_FACTOR_MESSAGE,
  );
}

function parse<S extends z.ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new Reply(
      400,
      ErrorCode.VALIDATION_ERROR,
      formatZodError(parsed.error),
    );
  }
  return parsed.data;
}

function answer(res: Response, error: unknown, label: string) {
  if (error instanceof Reply || error instanceof HttpFailure)
    return sendError(res, error.status, error.message, error.code);
  handleRouteError(res, error, label);
}

/** Email the code, or say plainly why not (never a "sent" with nothing sent). */
async function emailCodeOrReply(user: User): Promise<void> {
  const result = await sendMfaEmailCode(user);
  if (result === "cooldown") {
    throw new Reply(
      429,
      ErrorCode.RATE_LIMITED,
      "Wait a moment before asking for another code.",
    );
  }
  if (result === "capped") {
    throw new Reply(
      429,
      ErrorCode.MFA_EMAIL_DAILY_LIMIT,
      "Too many codes today. Use the newest one in your email, or try again tomorrow.",
    );
  }
}

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
          return sendError(
            res,
            401,
            INVALID_SECOND_FACTOR_MESSAGE,
            ErrorCode.INVALID_SECOND_FACTOR,
          );
        }

        const fail = (status: number, code: string, error: string) =>
          sendError(res, status, error, code);

        if (!(await storage.consumeMfaChallenge(tokenHash))) {
          return fail(401, ErrorCode.MFA_CHALLENGE_EXPIRED, CHALLENGE_EXPIRED);
        }

        if (row.purpose === "link") {
          let identity;
          try {
            identity = await storage.completeLinkByTicketHash(
              row.linkTicketHash!,
              {
                markEmailVerified: row.linkMarkEmailVerified,
                tokenVersion: row.tokenVersion,
              },
            );
          } catch (err) {
            // A reset landed after the check above: the link is rolled back.
            if (err instanceof TokenVersionChangedError) {
              return fail(
                401,
                ErrorCode.MFA_CHALLENGE_EXPIRED,
                CHALLENGE_EXPIRED,
              );
            }
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
          session = await issueSession(user.id, row.tokenVersion);
        } catch (err) {
          if (err instanceof HttpFailure)
            return fail(err.status, err.code, err.message);
          throw err;
        }
        const trustKey =
          row.purpose === "login" && trustDevice ? newTrustKey() : undefined;
        if (trustKey)
          await storage.trustDevice(user.id, hashTrustKey(trustKey));
        res.json({ ...session, ...(trustKey ? { trustKey } : {}) });
      } catch (error) {
        handleRouteError(res, error, "verify second factor");
      }
    },
  );

  // Turn two-step on. Gated on the server being able to send email — two-step
  // must never turn on where its codes can't arrive.
  app.post(
    "/api/auth/mfa/email/setup",
    requireAuth,
    reauthLimiter,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const { password } = parse(mfaPasswordSchema, req.body);
        const user = await me(req);
        if (user.password === null) {
          throw new Reply(
            409,
            ErrorCode.MFA_NEEDS_PASSWORD,
            "Set a password first — two-step verification protects password sign-in.",
          );
        }
        await requirePassword(user, password);
        if (user.mfaEnabledAt !== null) {
          throw new Reply(
            409,
            ErrorCode.MFA_ALREADY_ENABLED,
            "Two-step verification is already on.",
          );
        }
        if (!emailVerificationEnabled()) {
          throw new Reply(
            503,
            ErrorCode.MFA_UNAVAILABLE,
            MFA_UNAVAILABLE_MESSAGE,
          );
        }
        if (!user.emailVerified) {
          throw new Reply(
            409,
            ErrorCode.EMAIL_NOT_VERIFIED,
            "Confirm your email address first, so the codes reach you.",
          );
        }
        await emailCodeOrReply(user);
        res.json({ status: "code_sent", emailHint: maskEmail(user.email) });
      } catch (error) {
        answer(res, error, "start email two-step setup");
      }
    },
  );

  // Finish email setup with the code. Every other session ends; this one gets
  // a fresh token minted under the version the write set.
  app.post(
    "/api/auth/mfa/email/confirm",
    requireAuth,
    mfaVerifyLimiter,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const { code } = parse(mfaConfirmSchema, req.body);
        const user = await me(req);
        if (user.mfaEnabledAt !== null) {
          throw new Reply(
            409,
            ErrorCode.MFA_ALREADY_ENABLED,
            "Two-step verification is already on.",
          );
        }
        const wrong = new Reply(
          400,
          ErrorCode.INVALID_SECOND_FACTOR,
          "That code didn't work. Check the newest email, or ask for a new code.",
        );
        const stored = await storage.reserveMfaEmailAttempt(user.id);
        if (!stored || !signInCodeMatches(user.id, code, stored)) throw wrong;
        const version = await storage.enableEmailMfa(user.id, stored);
        if (version === undefined) throw wrong;
        invalidateTokenVersionCache(user.id);
        notice(user, "enabled");
        res.json(await issueSession(user.id, version));
      } catch (error) {
        answer(res, error, "confirm email two-step setup");
      }
    },
  );

  // "Resend code" on the sign-in screen. No requireAuth: the live challenge is
  // the credential, read WITHOUT spending one of its guesses. The code goes
  // only to the account's own address.
  app.post(
    "/api/auth/mfa/email/resend",
    mfaEmailSendLimiter,
    async (req: Request, res: Response) => {
      try {
        const { challenge } = parse(mfaEmailResendSchema, req.body);
        const expired = new Reply(
          401,
          ErrorCode.MFA_CHALLENGE_EXPIRED,
          CHALLENGE_EXPIRED,
        );
        const row = await storage.getLiveMfaChallenge(
          hashChallengeToken(challenge),
        );
        if (!row) throw expired;
        const user = await storage.getUserForAuth(row.userId);
        if (!user || user.tokenVersion !== row.tokenVersion) throw expired;
        requireEnabled(user);
        await emailCodeOrReply(user);
        res.json({ status: "code_sent", emailHint: maskEmail(user.email) });
      } catch (error) {
        answer(res, error, "resend two-step code");
      }
    },
  );

  // "Email me a code" next to a signed-in code field (change password, email
  // change, turning two-step off).
  app.post(
    "/api/auth/mfa/email/send",
    requireAuth,
    mfaEmailSendLimiter,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const user = await me(req);
        requireEnabled(user);
        await emailCodeOrReply(user);
        res.json({ status: "code_sent", emailHint: maskEmail(user.email) });
      } catch (error) {
        answer(res, error, "send two-step code");
      }
    },
  );

  // Turn off: password + factor. Every session ends; this one gets a new token.
  app.post(
    "/api/auth/mfa/disable",
    requireAuth,
    reauthLimiter,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const body = parse(mfaDisableSchema, req.body);
        const user = await me(req);
        await requirePassword(user, body.password);
        requireEnabled(user);
        await requireFactor(user, body.secondFactor);
        const version = await storage.disableMfa(user.id);
        if (version === undefined) {
          throw new Reply(404, ErrorCode.NOT_FOUND, "User not found");
        }
        invalidateTokenVersionCache(user.id);
        notice(user, "disabled");
        // Only under the version this write set (auth audit L3, as L12).
        res.json(await issueSession(user.id, version));
      } catch (error) {
        answer(res, error, "turn off two-step verification");
      }
    },
  );

  // "Forget trusted phones": every phone asks for the code again next time.
  app.delete(
    "/api/auth/mfa/trusted-devices",
    requireAuth,
    reauthLimiter,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        await storage.forgetTrustedDevices(req.userId);
        res.status(204).end();
      } catch (error) {
        answer(res, error, "forget trusted phones");
      }
    },
  );
}
