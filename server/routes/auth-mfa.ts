import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import type { User } from "@shared/schema";
import type { z } from "zod";
import {
  requireAuth,
  invalidateTokenVersionCache,
  type AuthenticatedRequest,
} from "../middleware/auth";
import {
  sendTwoFactorNotice,
  sendPasswordChangedNotice,
} from "../services/email";
import { fireAndForget } from "../lib/fire-and-forget";
import { passwordMatches } from "../lib/password-check";
import { hashPassword } from "../lib/password-hash";
import {
  PASSWORD_MIN_SINGLE_FACTOR,
  passwordLength,
} from "@shared/constants/password-policy";
import { checkNewPassword } from "./_password-rules";
import { base32Decode, matchTotp, otpauthUrl } from "../lib/mfa/totp";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { handleRouteError, formatZodError } from "./_helpers";
import { mfaVerifyLimiter, reauthLimiter } from "./_rate-limiters";
import {
  mfaConfirmSchema,
  mfaDisableSchema,
  mfaPasswordAndFactorSchema,
  mfaPasswordSchema,
  mfaVerifySchema,
} from "./_schemas";
import { isUniqueViolation } from "../lib/db-errors";
import {
  decryptMfaSecret,
  encryptMfaSecret,
  generateRecoveryCodes,
  hashChallengeToken,
  hashRecoveryCode,
  hashTrustKey,
  mfaConfigured,
  newTotpSecret,
  newTrustKey,
  normalizeRecoveryCode,
} from "../lib/mfa/mfa-secrets";
import { verifySecondFactor } from "../lib/mfa/verify-second-factor";
import { INVALID_SECOND_FACTOR_MESSAGE } from "../lib/mfa/password-proof-gate";
import { HttpFailure, issueSession } from "./auth-social";

// Two-step verification — spec docs/superpowers/specs/2026-10-10-totp-second-factor-design.md.
// Never log a code, recovery code, challenge, trust key or secret.

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

/** The current factor (code or recovery code); returns a spent code's replacement. */
async function requireFactor(
  user: User,
  secondFactor: { code: string } | { recoveryCode: string },
): Promise<{ replacementRecoveryCode?: string }> {
  const r = await verifySecondFactor(user, secondFactor);
  if (r.ok) {
    return r.replacementRecoveryCode
      ? { replacementRecoveryCode: r.replacementRecoveryCode }
      : {};
  }
  if (r.reason === "unavailable") {
    throw new Reply(503, ErrorCode.MFA_UNAVAILABLE, MFA_UNAVAILABLE_MESSAGE);
  }
  throw new Reply(
    401,
    ErrorCode.INVALID_SECOND_FACTOR,
    INVALID_SECOND_FACTOR_MESSAGE,
  );
}

/** Stage a fresh secret (first setup or new phone) and hand it to the app once. */
// Stages only if the account is still in the state the caller checked (setup:
// MFA off, new phone: MFA on) — a race with a confirm answers 409 (audit L13).
async function stageSecret(user: User) {
  requireConfigured();
  const secret = newTotpSecret();
  const mfaEnabled = user.mfaEnabledAt !== null;
  const staged = await storage.startTotpEnrollment(
    user.id,
    encryptMfaSecret(secret),
    { mfaEnabled },
  );
  if (!staged) {
    throw mfaEnabled
      ? new Reply(
          409,
          ErrorCode.MFA_NOT_ENABLED,
          "Two-step verification is off.",
        )
      : new Reply(
          409,
          ErrorCode.MFA_ALREADY_ENABLED,
          "Two-step verification is already on.",
        );
  }
  return { secret, otpauthUrl: otpauthUrl(secret, user.username) };
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

function answer(
  res: Response,
  error: unknown,
  label: string,
  extra?: Record<string, unknown>,
) {
  if (error instanceof Reply || error instanceof HttpFailure)
    return sendError(res, error.status, error.message, error.code, extra);
  handleRouteError(res, error, label, extra);
}

function requireConfigured(): void {
  if (!mfaConfigured()) {
    throw new Reply(503, ErrorCode.MFA_UNAVAILABLE, MFA_UNAVAILABLE_MESSAGE);
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

  // Start setup: password → a secret to add to the authenticator app. Off until
  // the owner flips MFA_SETUP_ENABLED (never gates sign-in for existing users).
  app.post(
    "/api/auth/mfa/totp/setup",
    requireAuth,
    reauthLimiter,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        if (process.env.MFA_SETUP_ENABLED !== "true") {
          throw new Reply(
            403,
            ErrorCode.MFA_SETUP_DISABLED,
            "Two-step verification isn't available yet.",
          );
        }
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
        res.json(await stageSecret(user));
      } catch (error) {
        answer(res, error, "start two-step setup");
      }
    },
  );

  // New phone: password + the CURRENT factor (or a recovery code) → a new secret.
  app.post(
    "/api/auth/mfa/totp/reset",
    requireAuth,
    reauthLimiter,
    async (req: AuthenticatedRequest, res: Response) => {
      let replacement: { replacementRecoveryCode?: string } = {};
      try {
        const body = parse(mfaPasswordAndFactorSchema, req.body);
        const user = await me(req);
        await requirePassword(user, body.password);
        requireEnabled(user);
        // Before the factor: a missing key must not spend a recovery code.
        requireConfigured();
        replacement = await requireFactor(user, body.secondFactor);
        res.json({ ...(await stageSecret(user)), ...replacement });
      } catch (error) {
        // Once a recovery code is spent, every answer carries its replacement.
        answer(res, error, "start new-phone setup", replacement);
      }
    },
  );

  // Finish setup or a new phone with a code from the app. Every other session
  // ends (tokenVersion bump); this one gets a fresh token minted after it.
  app.post(
    "/api/auth/mfa/totp/confirm",
    requireAuth,
    mfaVerifyLimiter,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const { code } = parse(mfaConfirmSchema, req.body);
        const user = await me(req);
        const wrong = new Reply(
          400,
          ErrorCode.INVALID_SECOND_FACTOR,
          INVALID_SECOND_FACTOR_MESSAGE,
        );
        const pendingEnc = await storage.getPendingTotpSecret(user.id);
        if (!pendingEnc) throw wrong;
        let secret: Buffer;
        try {
          secret = base32Decode(decryptMfaSecret(pendingEnc));
        } catch {
          throw new Reply(
            503,
            ErrorCode.MFA_UNAVAILABLE,
            MFA_UNAVAILABLE_MESSAGE,
          );
        }
        const step = matchTotp(secret, code, Date.now());
        if (step === null) {
          // Counted toward the same lock as every other factor check (spec §6,
          // audit L9); a locked account's pending secret reads as absent.
          const { tripped } = await storage.recordMfaFailure(user.id);
          if (tripped) notice(user, "locked");
          throw wrong;
        }

        let recoveryCodes: string[] | undefined;
        if (user.mfaEnabledAt === null) {
          recoveryCodes = generateRecoveryCodes();
          const version = await storage.confirmTotpEnrollment(user.id, {
            acceptedStep: step,
            recoveryHashes: recoveryCodes.map((c) =>
              hashRecoveryCode(user.id, normalizeRecoveryCode(c)!),
            ),
          });
          if (version === undefined) {
            throw new Reply(
              409,
              ErrorCode.MFA_ALREADY_ENABLED,
              "Two-step verification is already on.",
            );
          }
          notice(user, "enabled");
        } else {
          const version = await storage.confirmNewPhone(user.id, {
            acceptedStep: step,
          });
          if (version === undefined) {
            throw new Reply(
              409,
              ErrorCode.MFA_NOT_ENABLED,
              "Two-step verification is off.",
            );
          }
          notice(user, "new_phone");
        }
        invalidateTokenVersionCache(user.id);
        res.json({
          ...(await issueSession(user.id)),
          ...(recoveryCodes ? { recoveryCodes } : {}),
        });
      } catch (error) {
        answer(res, error, "confirm two-step setup");
      }
    },
  );

  // Turn off: password + factor. Every session ends; this one gets a new token.
  // A password under 15 can't stand alone, so it must be replaced in the same
  // step (spec §5.4).
  app.post(
    "/api/auth/mfa/disable",
    requireAuth,
    reauthLimiter,
    async (req: AuthenticatedRequest, res: Response) => {
      // Once a recovery code is spent, a failure before MFA is off must still
      // hand back its replacement (audit L11).
      let replacement: { replacementRecoveryCode?: string } = {};
      try {
        const body = parse(mfaDisableSchema, req.body);
        const user = await me(req);
        await requirePassword(user, body.password);
        requireEnabled(user);
        // Before the factor check, so a policy rejection never spends a
        // recovery code (spec §5.4 as amended by the PR 1 plan).
        if (
          !body.newPassword &&
          passwordLength(body.password) < PASSWORD_MIN_SINGLE_FACTOR
        ) {
          throw new Reply(
            400,
            ErrorCode.PASSWORD_UPGRADE_NEEDED,
            "Your password is shorter than 15 characters. Choose a new one of at least 15 to turn off two-step verification.",
          );
        }
        let newPasswordHash: string | undefined;
        if (body.newPassword) {
          const rejected = await checkNewPassword(
            body.newPassword,
            PASSWORD_MIN_SINGLE_FACTOR,
            "single_factor",
          );
          // Answered here rather than thrown: the rejection is derived from
          // the new password, and a thrown value can reach the error logger.
          if (rejected) {
            sendError(res, rejected.status, rejected.message, rejected.code);
            return;
          }
          newPasswordHash = await hashPassword(body.newPassword);
        }
        replacement = await requireFactor(user, body.secondFactor);
        await storage.disableMfa(user.id, { newPasswordHash });
        invalidateTokenVersionCache(user.id);
        notice(user, "disabled");
        if (newPasswordHash) {
          fireAndForget(
            "password-changed-notice",
            sendPasswordChangedNotice(user.email, user.username),
          );
        }
        res.json(await issueSession(user.id));
      } catch (error) {
        answer(res, error, "turn off two-step verification", replacement);
      }
    },
  );

  // New recovery codes: password + factor. The old ones stop working.
  app.post(
    "/api/auth/mfa/recovery-codes",
    requireAuth,
    reauthLimiter,
    async (req: AuthenticatedRequest, res: Response) => {
      // Once a recovery code is spent, a failed replace leaves the old set in
      // place minus that code — hand back its replacement (audit L11).
      let replacement: { replacementRecoveryCode?: string } = {};
      try {
        const body = parse(mfaPasswordAndFactorSchema, req.body);
        const user = await me(req);
        await requirePassword(user, body.password);
        requireEnabled(user);
        replacement = await requireFactor(user, body.secondFactor);
        const recoveryCodes = generateRecoveryCodes();
        await storage.replaceRecoveryCodes(
          user.id,
          recoveryCodes.map((c) =>
            hashRecoveryCode(user.id, normalizeRecoveryCode(c)!),
          ),
        );
        notice(user, "recovery_codes_replaced");
        res.json({ recoveryCodes });
      } catch (error) {
        answer(res, error, "replace recovery codes", replacement);
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
