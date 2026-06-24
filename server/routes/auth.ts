import type { Express, Request, Response } from "express";
import bcrypt from "bcrypt";
import { storage } from "../storage";
import type { UpdatableUserFields } from "../storage";
import {
  requireAuth,
  generateToken,
  invalidateTokenVersionCache,
  type AuthenticatedRequest,
} from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { detectImageMimeType } from "../lib/image-mime";
import { saveAvatar, deleteImage } from "../lib/image-store";
import { fireAndForget } from "../lib/fire-and-forget";
import { handleRouteError, formatZodError } from "./_helpers";
import { emailVerificationEnabled } from "../lib/email-config";
import {
  signVerificationToken,
  verifyVerificationToken,
} from "../lib/verification-token";
import {
  sendVerificationEmail,
  sendSignupAttemptNotice,
} from "../services/email";
import { renderVerifyEmailPage } from "../lib/verify-email-page";
import { createServiceLogger, toError } from "../lib/logger";
import {
  registerLimiter,
  loginLimiter,
  loginAccountLimiter,
  avatarRateLimit,
  accountDeletionLimiter,
  crudRateLimit,
  verifyEmailLimiter,
  resendVerificationLimiter,
  changeEmailLimiter,
} from "./_rate-limiters";
import {
  loginSchema,
  registerSchema,
  deleteAccountSchema,
  profileUpdateSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  changeEmailSchema,
} from "./_schemas";
import { upload } from "./_upload";
import { isUniqueViolation, uniqueViolationConstraint } from "../lib/db-errors";
import type { MeasurementUnit } from "@shared/lib/units";

function serializeUser(user: {
  id: string;
  username: string;
  email: string;
  emailVerified: boolean;
  displayName: string | null;
  avatarUrl: string | null;
  dailyCalorieGoal: number | null;
  onboardingCompleted: boolean | null;
  subscriptionTier: string | null;
  measurementUnit: MeasurementUnit;
}) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    emailVerified: user.emailVerified,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    dailyCalorieGoal: user.dailyCalorieGoal,
    onboardingCompleted: user.onboardingCompleted,
    subscriptionTier: user.subscriptionTier || "free",
    measurementUnit: user.measurementUnit,
  };
}

function sendVerificationPending(res: Response): void {
  // Content-free neutral response — identical for new / existing-unverified /
  // existing-verified signups so the registrant cannot enumerate emails.
  res.status(200).json({
    status: "verification_pending",
    message: "Check your inbox to verify your email.",
  });
}

const logger = createServiceLogger("auth");

/**
 * Verify an email-verification token and flip the account to verified. Shared by
 * the POST API (in-app deep-link path) and the GET browser landing so the two
 * entry points can never drift. Returns whether verification succeeded — false
 * for a bad/expired token OR an unknown user. Idempotent: re-verifying an
 * already-verified account is a harmless success.
 */
async function applyVerificationToken(token: string): Promise<boolean> {
  const payload = verifyVerificationToken(token);
  if (!payload) return false;
  // Pass the token's `email` claim so markEmailVerified only flips verified when
  // it still matches the row's current email. A stale link issued for a PREVIOUS
  // address (before an email change) updates zero rows → false → neutral 400, so
  // it can never mark a newly-changed, unverified address as verified.
  const user = await storage.markEmailVerified(payload.sub, payload.email);
  return Boolean(user);
}

export function register(app: Express): void {
  app.post(
    "/api/auth/register",
    registerLimiter,
    async (req: Request, res: Response) => {
      try {
        const parsed = registerSchema.safeParse(req.body);
        if (!parsed.success) {
          sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }
        const { username, password, email } = parsed.data;
        const verificationOn = emailVerificationEnabled();

        // Username uniqueness FIRST — keeps the existing 409. This is the only
        // signup response that is NOT the neutral check-inbox (spec §6a).
        const existingUser = await storage.getUserByUsername(username);
        if (existingUser) {
          return sendError(
            res,
            409,
            "Username already exists",
            ErrorCode.CONFLICT,
          );
        }

        // Constant-time anti-enumeration: when verification is ON, pay the
        // bcrypt cost BEFORE the email-existence check so the existing-email
        // and new-account branches take the same wall-clock (~250ms bcrypt
        // dominates). Otherwise response latency leaks whether the email is
        // already registered — defeating the neutral 200 below. The OFF path
        // keeps its fast 409 (not anti-enumerating anyway), hashing only when
        // it actually creates an account.
        const precomputedHash = verificationOn
          ? await bcrypt.hash(password, 12)
          : null;

        const existingEmail = await storage.getUserByEmail(email);
        if (existingEmail) {
          if (!verificationOn) {
            // Fail-open: pre-feature behavior (explicit 409, no anti-enum).
            return sendError(
              res,
              409,
              "Email already registered",
              ErrorCode.CONFLICT,
            );
          }
          // Verification ON: anti-enumeration. Same neutral response either way;
          // NEVER create an account and NEVER touch the existing password.
          if (!existingEmail.emailVerified) {
            // Unverified retry → help them finish, don't alarm them.
            fireAndForget(
              "resend-verification-on-reregister",
              sendVerificationEmail(
                email,
                signVerificationToken(existingEmail.id, email),
              ),
            );
          } else {
            fireAndForget(
              "signup-attempt-notice",
              sendSignupAttemptNotice(email),
            );
          }
          return sendVerificationPending(res);
        }

        const hashedPassword =
          precomputedHash ?? (await bcrypt.hash(password, 12));
        let user;
        try {
          user = await storage.createUser({
            username,
            password: hashedPassword,
            email,
          });
        } catch (err) {
          // Catch unique-violation from a concurrent registration (unchanged).
          if (isUniqueViolation(err)) {
            const constraint = uniqueViolationConstraint(err);
            if (constraint?.includes("email")) {
              // Email-constraint race: ON → neutral (no existence leak);
              // OFF → original explicit message.
              return verificationOn
                ? sendVerificationPending(res)
                : sendError(
                    res,
                    409,
                    "Email already registered",
                    ErrorCode.CONFLICT,
                  );
            }
            return sendError(
              res,
              409,
              "Username already exists",
              ErrorCode.CONFLICT,
            );
          }
          throw err;
        }

        if (verificationOn) {
          fireAndForget(
            "send-verification-email",
            sendVerificationEmail(email, signVerificationToken(user.id, email)),
          );
          return sendVerificationPending(res);
        }

        // Fail-open: pre-feature auto-login (201 + token).
        const token = generateToken(
          user.id.toString(),
          user.tokenVersion,
          user.emailVerified,
        );
        return res.status(201).json({ user: serializeUser(user), token });
      } catch (error) {
        handleRouteError(res, error, "create account");
      }
    },
  );

  app.post(
    "/api/auth/login",
    loginLimiter,
    loginAccountLimiter,
    async (req: Request, res: Response) => {
      try {
        const validated = loginSchema.parse(req.body);

        const user = await storage.getUserByUsernameForAuth(validated.username);
        if (!user) {
          return sendError(
            res,
            401,
            "Invalid credentials",
            ErrorCode.UNAUTHORIZED,
          );
        }

        const isValidPassword = await bcrypt.compare(
          validated.password,
          user.password,
        );
        if (!isValidPassword) {
          return sendError(
            res,
            401,
            "Invalid credentials",
            ErrorCode.UNAUTHORIZED,
          );
        }

        if (emailVerificationEnabled() && !user.emailVerified) {
          // Reachable only AFTER correct credentials → not an enumeration oracle.
          return sendError(
            res,
            403,
            "Email not verified",
            ErrorCode.EMAIL_NOT_VERIFIED,
          );
        }

        const token = generateToken(
          user.id.toString(),
          user.tokenVersion,
          user.emailVerified,
        );

        res.json({ user: serializeUser(user), token });
      } catch (error) {
        handleRouteError(res, error, "log in");
      }
    },
  );

  app.post(
    "/api/auth/verify-email",
    verifyEmailLimiter,
    async (req: Request, res: Response) => {
      try {
        const parsed = verifyEmailSchema.safeParse(req.body);
        if (!parsed.success) {
          sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }
        // Idempotent (already-verified is a harmless no-op). NO access token is
        // issued — verification proves email ownership, not password possession.
        const ok = await applyVerificationToken(parsed.data.token);
        if (!ok) {
          return sendError(
            res,
            400,
            "Invalid or expired verification link",
            ErrorCode.VALIDATION_ERROR,
          );
        }
        res.status(200).json({ status: "verified" });
      } catch (error) {
        handleRouteError(res, error, "verify email");
      }
    },
  );

  // Browser landing for the verification email link (built in services/email.ts
  // as `${EMAIL_VERIFY_BASE_URL}/verify-email?token=…`). A server-rendered HTML
  // page works in ANY mail client / browser with no app install, AASA
  // universal-link, or deployed web frontend — see lib/verify-email-page.ts.
  // Reuses applyVerificationToken so it can never drift from the POST API above.
  // Safe to verify on GET (no confirm step): the token is a stateless JWT and
  // markEmailVerified is idempotent, so a mail scanner pre-fetching the link
  // merely verifies the address early (the intended outcome anyway).
  //
  // SECURITY INVARIANT — this route MUST stay OUTSIDE the `/api` prefix. The
  // token rides in the query string, and pino-http's `autoLogging.ignore`
  // (server/index.ts) skips every URL that doesn't start with `/api`, so the
  // live 24h token never lands in access logs. Moving this under `/api/...`
  // would write that token to logs as a usable credential.
  app.get(
    "/verify-email",
    verifyEmailLimiter,
    async (req: Request, res: Response) => {
      const token = typeof req.query.token === "string" ? req.query.token : "";
      try {
        const ok = token.length > 0 && (await applyVerificationToken(token));
        res
          .status(ok ? 200 : 400)
          .type("html")
          .send(renderVerifyEmailPage(ok ? "success" : "invalid"));
      } catch (error) {
        // Deliberate deviation from the handleRouteError rule: this route serves
        // browser-facing HTML, not a JSON API — a JSON error envelope would be
        // unreadable to the user. Render an HTML error page (500) instead.
        logger.error({ err: toError(error) }, "verify-email landing failed");
        res.status(500).type("html").send(renderVerifyEmailPage("error"));
      }
    },
  );

  app.post(
    "/api/auth/resend-verification",
    resendVerificationLimiter,
    async (req: Request, res: Response) => {
      try {
        const parsed = resendVerificationSchema.safeParse(req.body);
        if (!parsed.success) {
          sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }
        const { email } = parsed.data;
        // Always neutral (anti-enumeration). Only actually send for an existing,
        // still-unverified account; the per-recipient throttle in email.ts caps
        // abuse. The lookup + return cost is identical whether or not the account
        // exists, so response timing is not an oracle either.
        const user = await storage.getUserByEmail(email);
        if (user && !user.emailVerified) {
          fireAndForget(
            "resend-verification",
            sendVerificationEmail(email, signVerificationToken(user.id, email)),
          );
        }
        res.status(200).json({
          status: "verification_pending",
          message: "If that account needs verification, we've sent a new link.",
        });
      } catch (error) {
        handleRouteError(res, error, "resend verification");
      }
    },
  );

  // Authenticated email change. Re-authenticates with the current password,
  // then stores the NEW address as unverified and (gate ON) emails a fresh
  // verification link to it. Mirrors register's ON/OFF gate semantics:
  //  - ON  → neutral verification_pending for free / taken / same-as-current,
  //          so a caller cannot enumerate which addresses already have accounts.
  //  - OFF → fail-open: returns the updated user; explicit 409 on a duplicate.
  // The session is intentionally NOT rotated — the password is unchanged, so the
  // current token stays valid; requireAuth does not gate on the emailVerified
  // claim (server/middleware/auth.ts), and the LOGIN endpoint re-checks
  // verification on the next sign-in, which is where re-verification is enforced.
  //
  // KNOWN LIMITATION: the email mutates immediately (the cross-check guard in
  // applyVerificationToken depends on this), so an authenticated caller can read
  // /api/auth/me afterward to tell whether a free target "took" — a costly,
  // self-destructive enumeration side channel (it overwrites the caller's own
  // email, locking them out at next login until they verify an address they do
  // not control). Tracked as a low-severity follow-up; a staging-column design
  // would close it.
  app.post(
    "/api/auth/change-email",
    requireAuth,
    changeEmailLimiter,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const parsed = changeEmailSchema.safeParse(req.body);
        if (!parsed.success) {
          sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }
        const { newEmail, password } = parsed.data;
        const verificationOn = emailVerificationEnabled();

        // Re-authenticate with the current password (getUserForAuth returns the
        // hash). Same 404 / 401 shape as DELETE /api/auth/account.
        const user = await storage.getUserForAuth(req.userId);
        if (!user) {
          return sendError(res, 404, "User not found", ErrorCode.NOT_FOUND);
        }
        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
          return sendError(
            res,
            401,
            "Invalid credentials",
            ErrorCode.UNAUTHORIZED,
          );
        }

        // Unchanged address (case-insensitive): no-op. Skips the write so the
        // current verified state is never reset and the row never self-collides
        // on the lower(email) unique index. (Stored email is already lowercased;
        // lowercase defensively in case a legacy row was not normalized.)
        if (newEmail === user.email.toLowerCase()) {
          return verificationOn
            ? sendVerificationPending(res)
            : res.json(serializeUser(user));
        }

        let updated;
        try {
          updated = await storage.updateUserEmail(req.userId, newEmail);
        } catch (err) {
          // updateUserEmail only mutates `email` + `emailVerified`, and
          // emailVerified is not unique — so the ONLY 23505 it can raise is an
          // email collision (either email unique index). Branch on the code
          // alone, NOT the constraint name: if the driver ever failed to surface
          // the functional-index name, a name-gated check would fall through to a
          // 500, and on the gate-ON path a 500-for-taken vs 200-for-free
          // response would itself be the enumeration oracle this endpoint exists
          // to prevent. (register needs the name-branch because createUser can
          // hit username OR email; this update cannot.)
          if (isUniqueViolation(err)) {
            return verificationOn
              ? sendVerificationPending(res)
              : sendError(
                  res,
                  409,
                  "Email already registered",
                  ErrorCode.CONFLICT,
                );
          }
          throw err;
        }
        if (!updated) {
          return sendError(res, 404, "User not found", ErrorCode.NOT_FOUND);
        }

        if (verificationOn) {
          // Reuse the same sign+send path as register/resend so the entry points
          // never drift; the token is bound to the NEW address.
          fireAndForget(
            "change-email-verification",
            sendVerificationEmail(
              newEmail,
              signVerificationToken(updated.id, newEmail),
            ),
          );
          return sendVerificationPending(res);
        }

        // Fail-open (gate OFF): return the updated user, mirroring register's
        // pre-feature path. No verification email is sent when the gate is off.
        return res.json(serializeUser(updated));
      } catch (error) {
        handleRouteError(res, error, "change email");
      }
    },
  );

  app.post(
    "/api/auth/logout",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        // Atomically increment tokenVersion to invalidate all existing tokens
        const user = await storage.incrementTokenVersion(req.userId);
        if (!user) {
          return sendError(res, 404, "User not found", ErrorCode.NOT_FOUND);
        }

        // Immediately invalidate the in-memory cache so revocation takes effect
        invalidateTokenVersionCache(req.userId);

        res.json({ success: true });
      } catch (error) {
        handleRouteError(res, error, "logout");
      }
    },
  );

  app.get(
    "/api/auth/me",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      // A bare async handler would also be safe (Express 5 auto-forwards
      // rejected promises to the global error middleware), but that path
      // returns { error: "Internal Server Error" } without a `code` field.
      // Catch explicitly so 500s here use the standard sendError envelope.
      try {
        const user = await storage.getUser(req.userId);
        if (!user) {
          return sendError(res, 401, "User not found", ErrorCode.UNAUTHORIZED);
        }

        res.json(serializeUser(user));
      } catch (error) {
        handleRouteError(res, error, "fetch current user");
      }
    },
  );

  app.put(
    "/api/auth/profile",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const validated = profileUpdateSchema.parse(req.body);
        const updates: Partial<UpdatableUserFields> = {};
        if (validated.displayName !== undefined)
          updates.displayName = validated.displayName;
        if (validated.dailyCalorieGoal !== undefined)
          updates.dailyCalorieGoal = validated.dailyCalorieGoal;
        if (validated.onboardingCompleted !== undefined)
          updates.onboardingCompleted = validated.onboardingCompleted;
        if (validated.measurementUnit !== undefined)
          updates.measurementUnit = validated.measurementUnit;

        if (Object.keys(updates).length === 0) {
          return sendError(
            res,
            400,
            "No valid fields to update",
            ErrorCode.VALIDATION_ERROR,
          );
        }

        const user = await storage.updateUser(req.userId, updates);

        if (!user) {
          return sendError(res, 404, "User not found", ErrorCode.NOT_FOUND);
        }

        res.json(serializeUser(user));
      } catch (error) {
        handleRouteError(res, error, "update profile");
      }
    },
  );

  // Account deletion (GDPR/CCPA compliance)
  app.delete(
    "/api/auth/account",
    requireAuth,
    accountDeletionLimiter,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const validated = deleteAccountSchema.parse(req.body);

        const user = await storage.getUserForAuth(req.userId);
        if (!user) {
          return sendError(res, 404, "User not found", ErrorCode.NOT_FOUND);
        }

        const isValidPassword = await bcrypt.compare(
          validated.password,
          user.password,
        );
        if (!isValidPassword) {
          return sendError(
            res,
            401,
            "Invalid credentials",
            ErrorCode.UNAUTHORIZED,
          );
        }

        // Delete user (cascades to all child tables via FK constraints)
        await storage.deleteUser(req.userId);

        // Invalidate token cache so any in-flight requests are rejected
        invalidateTokenVersionCache(req.userId);

        res.json({ success: true });

        // Clean up avatar after responding (fire-and-forget; account is
        // already gone, so a storage cleanup failure must not affect the
        // response or add ~50-300ms of R2 latency to it)
        fireAndForget(
          "account-deletion-avatar-cleanup",
          deleteImage(user.avatarUrl, "avatar"),
        );
      } catch (error) {
        handleRouteError(res, error, "delete account");
      }
    },
  );

  // Avatar upload endpoint
  app.post(
    "/api/user/avatar",
    requireAuth,
    avatarRateLimit,
    upload.single("avatar"),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        if (!req.file) {
          return sendError(
            res,
            400,
            "No image provided",
            ErrorCode.VALIDATION_ERROR,
          );
        }

        // Validate actual file content via magic bytes (do not trust client header)
        const detectedMime = detectImageMimeType(req.file.buffer);
        if (!detectedMime) {
          return sendError(
            res,
            400,
            "Invalid image content. Only JPEG, PNG, and WebP allowed.",
            ErrorCode.VALIDATION_ERROR,
          );
        }

        // Determine file extension from MIME type
        const ext =
          detectedMime === "image/jpeg"
            ? "jpg"
            : detectedMime === "image/png"
              ? "png"
              : "webp";
        // Old avatar (if any) is removed from storage after the new one lands.
        const currentUser = await storage.getUser(req.userId);
        const avatarUrl = await saveAvatar(req.file.buffer, ext);

        const user = await storage.updateUser(req.userId, { avatarUrl });

        if (!user) {
          // Best-effort rollback; the request already fails 404, so a cleanup
          // failure must not turn it into a 500. Stays awaited: the rollback
          // should complete before the failure response is finalized.
          await deleteImage(avatarUrl, "avatar").catch(() => {}); // roll back the just-uploaded object
          return sendError(res, 404, "User not found", ErrorCode.NOT_FOUND);
        }

        res.json({ avatarUrl: user.avatarUrl });

        // Clean up the old avatar after responding (fire-and-forget; a
        // storage failure must not affect a request whose updateUser already
        // succeeded, nor add R2 latency to the response).
        fireAndForget(
          "old-avatar-cleanup",
          deleteImage(currentUser?.avatarUrl, "avatar"),
        );
      } catch (error) {
        handleRouteError(res, error, "upload avatar");
      }
    },
  );

  // Avatar delete endpoint
  app.delete(
    "/api/user/avatar",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        // Clear the DB pointer first so a retryable storage cleanup failure
        // can't 500 the request or leave the row pointing at a deleted object.
        const currentUser = await storage.getUser(req.userId);

        const user = await storage.updateUser(req.userId, {
          avatarUrl: null,
        });

        if (!user) {
          return sendError(res, 404, "User not found", ErrorCode.NOT_FOUND);
        }

        res.json({ success: true });

        // Best-effort cleanup after responding, with the DB already cleared;
        // a storage failure must not affect a request whose updateUser
        // already succeeded, nor add R2 latency to the response.
        fireAndForget(
          "avatar-delete-cleanup",
          deleteImage(currentUser?.avatarUrl, "avatar"),
        );
      } catch (error) {
        handleRouteError(res, error, "delete avatar");
      }
    },
  );
}
