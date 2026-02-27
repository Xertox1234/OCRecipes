import type { Express, Request, Response } from "express";
import bcrypt from "bcrypt";
import * as fs from "fs";
import * as path from "path";
import { ZodError } from "zod";
import { storage } from "../storage";
import {
  requireAuth,
  generateToken,
  invalidateTokenVersionCache,
} from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { detectImageMimeType } from "../lib/image-mime";
import {
  registerLimiter,
  loginLimiter,
  avatarRateLimit,
  formatZodError,
  loginSchema,
  registerSchema,
  profileUpdateSchema,
  upload,
} from "./_helpers";

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
          return sendError(res, 409, "Username already exists");
        }

        const hashedPassword = await bcrypt.hash(validated.password, 10);
        const user = await storage.createUser({
          username: validated.username,
          password: hashedPassword,
        });

        const token = generateToken(user.id.toString(), user.tokenVersion);

        res.status(201).json({
          user: {
            id: user.id,
            username: user.username,
            displayName: user.displayName,
            avatarUrl: user.avatarUrl,
            dailyCalorieGoal: user.dailyCalorieGoal,
            onboardingCompleted: user.onboardingCompleted,
            subscriptionTier: user.subscriptionTier || "free",
          },
          token,
        });
      } catch (error) {
        if (error instanceof ZodError) {
          return sendError(res, 400, formatZodError(error));
        }
        console.error("Registration error:", error);
        sendError(res, 500, "Failed to create account");
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
          return sendError(res, 401, "Invalid credentials");
        }

        const isValidPassword = await bcrypt.compare(
          validated.password,
          user.password,
        );
        if (!isValidPassword) {
          return sendError(res, 401, "Invalid credentials");
        }

        const token = generateToken(user.id.toString(), user.tokenVersion);

        res.json({
          user: {
            id: user.id,
            username: user.username,
            displayName: user.displayName,
            avatarUrl: user.avatarUrl,
            dailyCalorieGoal: user.dailyCalorieGoal,
            onboardingCompleted: user.onboardingCompleted,
            subscriptionTier: user.subscriptionTier || "free",
          },
          token,
        });
      } catch (error) {
        if (error instanceof ZodError) {
          return sendError(res, 400, formatZodError(error));
        }
        console.error("Login error:", error);
        sendError(res, 500, "Failed to login");
      }
    },
  );

  app.post(
    "/api/auth/logout",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const user = await storage.getUser(req.userId!);
        if (!user) {
          return sendError(res, 404, "User not found");
        }

        // Increment tokenVersion to invalidate all existing tokens
        await storage.updateUser(req.userId!, {
          tokenVersion: user.tokenVersion + 1,
        });

        // Immediately invalidate the in-memory cache so revocation takes effect
        invalidateTokenVersionCache(req.userId!);

        res.json({ success: true });
      } catch (error) {
        console.error("Logout error:", error);
        sendError(res, 500, "Failed to logout");
      }
    },
  );

  app.get("/api/auth/me", requireAuth, async (req: Request, res: Response) => {
    const user = await storage.getUser(req.userId!);
    if (!user) {
      return sendError(res, 401, "User not found");
    }

    res.json({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      dailyCalorieGoal: user.dailyCalorieGoal,
      onboardingCompleted: user.onboardingCompleted,
      subscriptionTier: user.subscriptionTier || "free",
    });
  });

  app.put(
    "/api/auth/profile",
    requireAuth,
    async (req: Request, res: Response) => {
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
          return sendError(res, 400, "No valid fields to update");
        }

        const user = await storage.updateUser(req.userId!, updates);

        if (!user) {
          return sendError(res, 404, "User not found");
        }

        res.json({
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          dailyCalorieGoal: user.dailyCalorieGoal,
          onboardingCompleted: user.onboardingCompleted,
          subscriptionTier: user.subscriptionTier || "free",
        });
      } catch (error) {
        if (error instanceof ZodError) {
          return sendError(res, 400, formatZodError(error));
        }
        console.error("Profile update error:", error);
        sendError(res, 500, "Failed to update profile");
      }
    },
  );

  // Avatar upload endpoint - saves image to disk
  app.post(
    "/api/user/avatar",
    requireAuth,
    avatarRateLimit,
    upload.single("avatar"),
    async (req: Request, res: Response) => {
      try {
        if (!req.file) {
          return sendError(res, 400, "No image provided");
        }

        // Validate actual file content via magic bytes (do not trust client header)
        const detectedMime = detectImageMimeType(req.file.buffer);
        if (!detectedMime) {
          return sendError(
            res,
            400,
            "Invalid image content. Only JPEG, PNG, and WebP allowed.",
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
        const avatarDir = path.resolve(process.cwd(), "uploads/avatars");
        const filepath = path.join(avatarDir, filename);

        // Delete old avatar file if it exists
        const currentUser = await storage.getUser(req.userId!);
        if (currentUser?.avatarUrl?.startsWith("/api/avatars/")) {
          const oldFilename = currentUser.avatarUrl.replace(
            "/api/avatars/",
            "",
          );
          const oldPath = path.join(avatarDir, oldFilename);
          fs.unlink(oldPath, () => {}); // best-effort cleanup
        }

        // Write new avatar file to disk
        fs.writeFileSync(filepath, req.file.buffer);

        const avatarUrl = `/api/avatars/${filename}`;
        const user = await storage.updateUser(req.userId!, { avatarUrl });

        if (!user) {
          // Clean up the written file if user update fails
          fs.unlink(filepath, () => {});
          return sendError(res, 404, "User not found");
        }

        res.json({ avatarUrl: user.avatarUrl });
      } catch (error) {
        console.error("Avatar upload error:", error);
        sendError(res, 500, "Failed to upload avatar");
      }
    },
  );

  // Avatar delete endpoint
  app.delete(
    "/api/user/avatar",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        // Delete old avatar file if it exists
        const currentUser = await storage.getUser(req.userId!);
        if (currentUser?.avatarUrl?.startsWith("/api/avatars/")) {
          const filename = currentUser.avatarUrl.replace("/api/avatars/", "");
          const avatarDir = path.resolve(process.cwd(), "uploads/avatars");
          fs.unlink(path.join(avatarDir, filename), () => {}); // best-effort cleanup
        }

        const user = await storage.updateUser(req.userId!, {
          avatarUrl: null,
        });

        if (!user) {
          return sendError(res, 404, "User not found");
        }

        res.json({ success: true });
      } catch (error) {
        console.error("Avatar delete error:", error);
        sendError(res, 500, "Failed to delete avatar");
      }
    },
  );
}
