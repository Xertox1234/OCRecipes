import type { Express, Request, Response } from "express";
import { storage, ReservedUsernameError, isReservedUsername } from "../storage";
import type { ProviderName } from "../storage";
import {
  generateToken,
  requireAuth,
  type AuthenticatedRequest,
} from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { handleRouteError, formatZodError } from "./_helpers";
import { socialAuthLimiter } from "./_rate-limiters";
import {
  socialNonceSchema,
  socialSignInSchema,
  completeSocialSignUpSchema,
  socialLinkSchema,
} from "./_schemas";
import { serializeUser } from "./auth";
import { emailVerificationEnabled } from "../lib/email-config";
import { isUniqueViolation, uniqueViolationConstraint } from "../lib/db-errors";
import { passwordMatches } from "../lib/password-check";
import { getSocialConfig } from "../lib/social-identity/config";
import {
  verifyGoogleIdToken,
  verifyAppleIdToken,
  TokenVerificationError,
} from "../lib/social-identity/verify";
import {
  decideLink,
  isAuthoritative,
  type PolicyAccount,
} from "../lib/social-identity/linking-policy";
import { exchangeAppleCode } from "../lib/social-identity/apple-tokens";
import { encryptToken } from "../lib/social-identity/token-crypto";
import { signInGate, secondFactor } from "../lib/social-identity/sign-in-gates";
import { suggestUsername } from "../lib/social-identity/suggest-username";
import type {
  ProviderClaims,
  SignInMethod,
} from "../lib/social-identity/types";
import { createServiceLogger, toError } from "../lib/logger";
import type { User } from "@shared/schema";

const logger = createServiceLogger("auth-social");

class HttpFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function fail(res: Response, f: HttpFailure) {
  sendError(res, f.status, f.message, f.code);
}

/** Verify a provider token for a configured provider. Throws HttpFailure. */
export async function verifyProviderToken(
  provider: ProviderName,
  idToken: string,
  nonce: string,
): Promise<ProviderClaims> {
  const cfg = getSocialConfig();
  try {
    if (provider === "google") {
      if (!cfg.google)
        throw new HttpFailure(
          404,
          ErrorCode.PROVIDER_NOT_CONFIGURED,
          "Sign-in provider not available",
        );
      return await verifyGoogleIdToken(idToken, nonce, cfg.google);
    }
    if (!cfg.apple)
      throw new HttpFailure(
        404,
        ErrorCode.PROVIDER_NOT_CONFIGURED,
        "Sign-in provider not available",
      );
    return await verifyAppleIdToken(idToken, nonce, cfg.apple);
  } catch (err) {
    if (err instanceof TokenVerificationError) {
      throw new HttpFailure(
        401,
        ErrorCode.INVALID_PROVIDER_TOKEN,
        "Sign-in could not be verified",
      );
    }
    throw err;
  }
}

/** Exchange Apple's one-time code and return the ENCRYPTED refresh token. Throws HttpFailure. */
export async function appleRefreshTokenFor(
  code: string | undefined,
): Promise<string> {
  const cfg = getSocialConfig().apple;
  if (!cfg || !code) {
    throw new HttpFailure(
      502,
      ErrorCode.PROVIDER_EXCHANGE_FAILED,
      "Apple sign-in could not be completed. Please try again.",
    );
  }
  try {
    return encryptToken(await exchangeAppleCode(code, cfg));
  } catch (err) {
    logger.warn({ err: toError(err) }, "apple code exchange failed");
    throw new HttpFailure(
      502,
      ErrorCode.PROVIDER_EXCHANGE_FAILED,
      "Apple sign-in could not be completed. Please try again.",
    );
  }
}

export async function issueSession(userId: string) {
  const user = await storage.getUser(userId);
  if (!user)
    throw new HttpFailure(401, ErrorCode.UNAUTHORIZED, "User not found");
  return {
    status: "signed_in" as const,
    user: serializeUser(user),
    token: generateToken(user.id, user.tokenVersion, user.emailVerified),
  };
}

async function methodsFor(
  user: Pick<User, "id" | "password">,
): Promise<SignInMethod[]> {
  const identities = await storage.listIdentities(user.id);
  return [
    ...(user.password !== null ? (["password"] as const) : []),
    ...identities.map((i) => i.provider as SignInMethod),
  ];
}

function displayNameFrom(fullName?: {
  givenName: string | null;
  familyName: string | null;
}): string | null {
  const name = [fullName?.givenName, fullName?.familyName]
    .filter(Boolean)
    .join(" ")
    .trim();
  return name || null;
}

const isTaken = async (u: string) =>
  isReservedUsername(u) || Boolean(await storage.getUserByUsername(u));

export function register(app: Express): void {
  app.get("/api/auth/social/config", (_req: Request, res: Response) => {
    const cfg = getSocialConfig();
    res.json({ google: cfg.google !== null, apple: cfg.apple !== null });
  });

  // sign_in/link are public; reauth requires a session. A link nonce issued
  // to a signed-in caller is bound to them (POST /api/auth/identities).
  app.post(
    "/api/auth/social/nonce",
    socialAuthLimiter,
    async (req: Request, res: Response, next) => {
      const parsed = socialNonceSchema.safeParse(req.body);
      if (!parsed.success)
        return sendError(
          res,
          400,
          formatZodError(parsed.error),
          ErrorCode.VALIDATION_ERROR,
        );
      const auth = req.headers.authorization;
      if (
        parsed.data.purpose === "reauth" ||
        (parsed.data.purpose === "link" && auth)
      ) {
        return requireAuth(req as AuthenticatedRequest, res, next);
      }
      next();
    },
    async (req: Request, res: Response) => {
      try {
        const { purpose } = socialNonceSchema.parse(req.body);
        const userId =
          purpose === "sign_in"
            ? null
            : ((req as AuthenticatedRequest).userId ?? null);
        res.json(await storage.issueNonce(purpose, userId));
      } catch (error) {
        handleRouteError(res, error, "issue sign-in nonce");
      }
    },
  );

  app.post(
    "/api/auth/social",
    socialAuthLimiter,
    async (req: Request, res: Response) => {
      try {
        const parsed = socialSignInSchema.safeParse(req.body);
        if (!parsed.success)
          return sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
        const body = parsed.data;

        const claims = await verifyProviderToken(
          body.provider,
          body.idToken,
          body.nonce,
        );
        if (!(await storage.consumeNonce(body.nonce, "sign_in", null))) {
          throw new HttpFailure(
            401,
            ErrorCode.INVALID_PROVIDER_TOKEN,
            "Sign-in could not be verified",
          );
        }

        const linked = await storage.findIdentity(claims.provider, claims.sub);
        if (!linked && !claims.email) {
          throw new HttpFailure(
            400,
            ErrorCode.PROVIDER_EMAIL_REQUIRED,
            "Your account didn't share an email address. Please try again and allow email.",
          );
        }

        let emailAccount: PolicyAccount | null = null;
        let emailUser: User | undefined;
        if (!linked && claims.email) {
          emailUser = await storage.getUserByEmailForAuth(claims.email);
          if (emailUser) {
            emailAccount = {
              id: emailUser.id,
              email: emailUser.email,
              emailVerified: emailUser.emailVerified,
              hasSecondFactor: secondFactor.requiresSecondFactor(emailUser),
              methods: await methodsFor(emailUser),
            };
          }
        }

        const decision = decideLink({
          claims,
          linkedUserId: linked?.userId ?? null,
          emailAccount,
        });

        // Apple: a NEW identity must carry a refresh token (fail closed); an
        // existing one without a stored token gets a best-effort exchange.
        let appleTokenEnc: string | null = null;
        if (claims.provider === "apple") {
          if (!linked) {
            appleTokenEnc = await appleRefreshTokenFor(body.authorizationCode);
          } else if (!linked.appleRefreshTokenEnc && body.authorizationCode) {
            try {
              appleTokenEnc = await appleRefreshTokenFor(
                body.authorizationCode,
              );
            } catch {
              appleTokenEnc = null; // logged inside; never blocks a returning user
            }
          }
        }

        const verificationOn = emailVerificationEnabled();

        if (decision.kind === "sign_in") {
          const user = await storage.getUserForAuth(decision.userId);
          if (!user)
            throw new HttpFailure(
              401,
              ErrorCode.UNAUTHORIZED,
              "User not found",
            );
          const gate = signInGate(user, {
            emailWillBeVerified: false,
            verificationOn,
          });
          if (!gate.ok)
            throw new HttpFailure(gate.status, gate.code, gate.message);
          if (appleTokenEnc && linked) {
            await storage.setAppleRefreshToken(
              linked.id,
              user.id,
              appleTokenEnc,
            );
          }
          if (linked) await storage.touchIdentity(linked.id, user.id);
          return res.json(await issueSession(user.id));
        }

        if (decision.kind === "auto_link") {
          const user = emailUser!;
          const gate = signInGate(user, {
            emailWillBeVerified: true,
            verificationOn,
          });
          if (!gate.ok)
            throw new HttpFailure(gate.status, gate.code, gate.message);
          try {
            await storage.insertIdentity({
              userId: user.id,
              provider: claims.provider,
              providerSubject: claims.sub,
              email: claims.email,
              isPrivateRelay: claims.isPrivateRelay,
              appleRefreshTokenEnc: appleTokenEnc,
            });
          } catch (err) {
            if (isUniqueViolation(err))
              throw new HttpFailure(
                409,
                ErrorCode.IDENTITY_IN_USE,
                "This account is already connected.",
              );
            throw err;
          }
          return res.json(await issueSession(user.id));
        }

        // Spec §3.1: a provider-created account is verified only when the
        // provider verified the address. Password registration answers an
        // unverified address with an emailed code and no session; we have no
        // such path here, so refuse rather than create an unverified account
        // and hand it a session. (Apple always verifies; this is rare Google
        // accounts.)
        if (decision.kind === "choose_username" && !claims.emailVerified) {
          throw new HttpFailure(
            400,
            ErrorCode.PROVIDER_EMAIL_REQUIRED,
            "Your account's email address isn't verified with your provider. Verify it there, or create an account with a password.",
          );
        }

        const ticket = await storage.createPendingSignIn({
          kind: decision.kind === "choose_username" ? "sign_up" : "link",
          provider: claims.provider,
          providerSubject: claims.sub,
          email: claims.email!,
          isPrivateRelay: claims.isPrivateRelay,
          providerAuthoritative: isAuthoritative(claims),
          emailVerified: claims.emailVerified,
          displayName: displayNameFrom(body.fullName),
          appleRefreshTokenEnc: appleTokenEnc,
          targetUserId:
            decision.kind === "link_required" ? decision.userId : null,
        });

        if (decision.kind === "choose_username") {
          const seed =
            displayNameFrom(body.fullName) ?? claims.email!.split("@")[0];
          return res.json({
            status: "choose_username",
            ticket,
            suggestedUsername: await suggestUsername(seed, isTaken),
          });
        }
        return res.json({
          status: "link_required",
          ticket,
          methods: decision.methods,
          email: claims.email,
        });
      } catch (error) {
        if (error instanceof HttpFailure) return fail(res, error);
        handleRouteError(res, error, "sign in with provider");
      }
    },
  );

  app.post(
    "/api/auth/social/complete-sign-up",
    socialAuthLimiter,
    async (req: Request, res: Response) => {
      try {
        const parsed = completeSocialSignUpSchema.safeParse(req.body);
        if (!parsed.success)
          return sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
        const { ticket, username } = parsed.data;
        let user: User | undefined;
        try {
          user = await storage.createUserWithIdentity(ticket, username);
        } catch (err) {
          if (err instanceof ReservedUsernameError) {
            return sendError(
              res,
              409,
              "That username is reserved. Please choose another.",
              ErrorCode.CONFLICT,
            );
          }
          if (isUniqueViolation(err)) {
            const constraint = uniqueViolationConstraint(err) ?? "";
            return sendError(
              res,
              409,
              constraint.includes("email")
                ? "An account with this email already exists."
                : "Username already exists",
              ErrorCode.CONFLICT,
            );
          }
          throw err;
        }
        if (!user)
          return sendError(
            res,
            400,
            "This sign-in has expired. Please start again.",
            ErrorCode.INVALID_SIGN_IN_TICKET,
          );
        res.status(201).json(await issueSession(user.id));
      } catch (error) {
        if (error instanceof HttpFailure) return fail(res, error);
        handleRouteError(res, error, "complete social sign-up");
      }
    },
  );

  app.post(
    "/api/auth/social/link",
    socialAuthLimiter,
    async (req: Request, res: Response) => {
      try {
        const parsed = socialLinkSchema.safeParse(req.body);
        if (!parsed.success)
          return sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
        const body = parsed.data;
        const expired = new HttpFailure(
          400,
          ErrorCode.INVALID_SIGN_IN_TICKET,
          "This sign-in has expired. Please start again.",
        );

        let pending;
        if ("password" in body) {
          // Attempts are counted (max 5) so a wrong password keeps the ticket alive.
          pending = await storage.reservePendingLinkAttempt(body.ticket);
          if (!pending?.targetUserId) throw expired;
          const target = await storage.getUserForAuth(pending.targetUserId);
          if (
            !target ||
            !(await passwordMatches(body.password, target.password))
          ) {
            return sendError(
              res,
              401,
              "Invalid credentials",
              ErrorCode.UNAUTHORIZED,
            );
          }
        } else {
          pending = await storage.getPendingSignIn(body.ticket, "link");
          if (!pending?.targetUserId) throw expired;
          const proof = await verifyProviderToken(
            body.provider,
            body.idToken,
            body.nonce,
          );
          if (!(await storage.consumeNonce(body.nonce, "link", null))) {
            throw new HttpFailure(
              401,
              ErrorCode.INVALID_PROVIDER_TOKEN,
              "Sign-in could not be verified",
            );
          }
          const owned = await storage.findIdentity(proof.provider, proof.sub);
          if (!owned || owned.userId !== pending.targetUserId) {
            return sendError(
              res,
              401,
              "Invalid credentials",
              ErrorCode.UNAUTHORIZED,
            );
          }
        }

        const target = await storage.getUserForAuth(pending.targetUserId);
        if (!target) throw expired;
        const markEmailVerified =
          pending.providerAuthoritative &&
          pending.email === target.email.toLowerCase();
        const gate = signInGate(target, {
          emailWillBeVerified: markEmailVerified,
          verificationOn: emailVerificationEnabled(),
        });
        // Gate BEFORE inserting: a password alone never attaches a provider to an MFA account.
        if (!gate.ok)
          throw new HttpFailure(gate.status, gate.code, gate.message);

        let identity;
        try {
          identity = await storage.completeLinkFromTicket(body.ticket, {
            markEmailVerified,
          });
        } catch (err) {
          if (isUniqueViolation(err))
            throw new HttpFailure(
              409,
              ErrorCode.IDENTITY_IN_USE,
              "This account is already connected.",
            );
          throw err;
        }
        if (!identity) throw expired;
        res.json(await issueSession(target.id));
      } catch (error) {
        if (error instanceof HttpFailure) return fail(res, error);
        handleRouteError(res, error, "link provider");
      }
    },
  );
}
