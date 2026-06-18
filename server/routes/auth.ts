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
import {
  registerLimiter,
  loginLimiter,
  loginAccountLimiter,
  avatarRateLimit,
  accountDeletionLimiter,
  crudRateLimit,
} from "./_rate-limiters";
import {
  loginSchema,
  registerSchema,
  deleteAccountSchema,
  profileUpdateSchema,
} from "./_schemas";
import { upload } from "./_upload";
import { isUniqueViolation } from "../lib/db-errors";
import type { MeasurementUnit } from "@shared/lib/units";

function serializeUser(user: {
  id: string;
  username: string;
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
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    dailyCalorieGoal: user.dailyCalorieGoal,
    onboardingCompleted: user.onboardingCompleted,
    subscriptionTier: user.subscriptionTier || "free",
    measurementUnit: user.measurementUnit,
  };
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
        const validated = parsed.data;

        const existingUser = await storage.getUserByUsername(
          validated.username,
        );
        if (existingUser) {
          return sendError(
            res,
            409,
            "Username already exists",
            ErrorCode.CONFLICT,
          );
        }

        const existingEmail = await storage.getUserByEmail(validated.email);
        if (existingEmail) {
          return sendError(
            res,
            409,
            "Email already registered",
            ErrorCode.CONFLICT,
          );
        }

        const hashedPassword = await bcrypt.hash(validated.password, 12);
        let user;
        try {
          user = await storage.createUser({
            username: validated.username,
            password: hashedPassword,
            email: validated.email,
          });
        } catch (err) {
          // Catch unique constraint violation from concurrent registrations
          if (isUniqueViolation(err)) {
            return sendError(
              res,
              409,
              "Username already exists",
              ErrorCode.CONFLICT,
            );
          }
          throw err;
        }

        const token = generateToken(user.id.toString(), user.tokenVersion);

        res.status(201).json({ user: serializeUser(user), token });
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

        const token = generateToken(user.id.toString(), user.tokenVersion);

        res.json({ user: serializeUser(user), token });
      } catch (error) {
        handleRouteError(res, error, "log in");
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
