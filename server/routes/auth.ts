import type { Express, Request, Response } from "express";
import bcrypt from "bcrypt";
import fs, { promises as fsp } from "fs";
import * as path from "path";
import { storage } from "../storage";
import {
  requireAuth,
  generateToken,
  invalidateTokenVersionCache,
  type AuthenticatedRequest,
} from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { detectImageMimeType } from "../lib/image-mime";
import {
  registerLimiter,
  loginLimiter,
  avatarRateLimit,
  accountDeletionLimiter,
  crudRateLimit,
  handleRouteError,
  loginSchema,
  registerSchema,
  deleteAccountSchema,
  profileUpdateSchema,
  upload,
} from "./_helpers";
import { logger, toError } from "../lib/logger";

const AVATAR_DIR = path.resolve(process.cwd(), "uploads/avatars");
fs.mkdirSync(AVATAR_DIR, { recursive: true });

function deleteOldAvatarFile(avatarUrl: string | null | undefined): void {
  if (!avatarUrl?.startsWith("/api/avatars/")) return;
  const safeName = path.basename(avatarUrl);
  fs.unlink(path.join(AVATAR_DIR, safeName), () => {});
}

function serializeUser(user: {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  dailyCalorieGoal: number | null;
  onboardingCompleted: boolean | null;
  subscriptionTier: string | null;
}) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    dailyCalorieGoal: user.dailyCalorieGoal,
    onboardingCompleted: user.onboardingCompleted,
    subscriptionTier: user.subscriptionTier || "free",
  };
}

export function register(app: Express): void {
  app.post(
    "/api/auth/register",
    registerLimiter,
    async (req: Request, res: Response) => {
      try {
        const validated = registerSchema.parse(req.body);

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

        const hashedPassword = await bcrypt.hash(validated.password, 12);
        let user;
        try {
          user = await storage.createUser({
            username: validated.username,
            password: hashedPassword,
          });
        } catch (err) {
          // Catch unique constraint violation from concurrent registrations
          const msg = toError(err).message;
          if (msg.includes("23505") || msg.includes("unique")) {
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
    async (req: Request, res: Response) => {
      try {
        const validated = loginSchema.parse(req.body);

        const user = await storage.getUserByUsername(validated.username);
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
        const user = await storage.getUser(req.userId);
        if (!user) {
          return sendError(res, 404, "User not found", ErrorCode.NOT_FOUND);
        }

        // Increment tokenVersion to invalidate all existing tokens
        await storage.updateUser(req.userId, {
          tokenVersion: user.tokenVersion + 1,
        });

        // Immediately invalidate the in-memory cache so revocation takes effect
        invalidateTokenVersionCache(req.userId);

        res.json({ success: true });
      } catch (error) {
        logger.error({ err: toError(error) }, "logout error");
        sendError(res, 500, "Failed to logout", ErrorCode.INTERNAL_ERROR);
      }
    },
  );

  app.get(
    "/api/auth/me",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      const user = await storage.getUser(req.userId);
      if (!user) {
        return sendError(res, 401, "User not found", ErrorCode.UNAUTHORIZED);
      }

      res.json(serializeUser(user));
    },
  );

  app.put(
    "/api/auth/profile",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const validated = profileUpdateSchema.parse(req.body);
        const updates: Record<string, unknown> = {};
        if (validated.displayName !== undefined)
          updates.displayName = validated.displayName;
        if (validated.dailyCalorieGoal !== undefined)
          updates.dailyCalorieGoal = validated.dailyCalorieGoal;
        if (validated.onboardingCompleted !== undefined)
          updates.onboardingCompleted = validated.onboardingCompleted;

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

        const user = await storage.getUser(req.userId);
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

        // Clean up avatar file after successful deletion
        deleteOldAvatarFile(user.avatarUrl);

        res.json({ success: true });
      } catch (error) {
        handleRouteError(res, error, "delete account");
      }
    },
  );

  // Avatar upload endpoint - saves image to disk
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
        const filename = `${req.userId}-${Date.now()}.${ext}`;
        const filepath = path.join(AVATAR_DIR, filename);

        // Delete old avatar file if it exists (path.basename prevents traversal)
        const currentUser = await storage.getUser(req.userId);
        deleteOldAvatarFile(currentUser?.avatarUrl);

        await fsp.writeFile(filepath, req.file.buffer);

        const avatarUrl = `/api/avatars/${filename}`;
        const user = await storage.updateUser(req.userId, { avatarUrl });

        if (!user) {
          fs.unlink(filepath, () => {});
          return sendError(res, 404, "User not found", ErrorCode.NOT_FOUND);
        }

        res.json({ avatarUrl: user.avatarUrl });
      } catch (error) {
        logger.error({ err: toError(error) }, "avatar upload error");
        sendError(
          res,
          500,
          "Failed to upload avatar",
          ErrorCode.INTERNAL_ERROR,
        );
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
        const currentUser = await storage.getUser(req.userId);
        deleteOldAvatarFile(currentUser?.avatarUrl);

        const user = await storage.updateUser(req.userId, {
          avatarUrl: null,
        });

        if (!user) {
          return sendError(res, 404, "User not found", ErrorCode.NOT_FOUND);
        }

        res.json({ success: true });
      } catch (error) {
        logger.error({ err: toError(error) }, "avatar delete error");
        sendError(
          res,
          500,
          "Failed to delete avatar",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );
}
