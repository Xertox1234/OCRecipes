import type { Express, Request, Response } from "express";
import bcrypt from "bcrypt";
import { ZodError } from "zod";
import { storage } from "../storage";
import { requireAuth, generateToken } from "../middleware/auth";
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
          return res.status(409).json({ error: "Username already exists" });
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
          return res.status(400).json({ error: formatZodError(error) });
        }
        console.error("Registration error:", error);
        res.status(500).json({ error: "Failed to create account" });
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
          return res.status(401).json({ error: "Invalid credentials" });
        }

        const isValidPassword = await bcrypt.compare(
          validated.password,
          user.password,
        );
        if (!isValidPassword) {
          return res.status(401).json({ error: "Invalid credentials" });
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
          return res.status(400).json({ error: formatZodError(error) });
        }
        console.error("Login error:", error);
        res.status(500).json({ error: "Failed to login" });
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
          return res.status(404).json({ error: "User not found" });
        }

        // Increment tokenVersion to invalidate all existing tokens
        await storage.updateUser(req.userId!, {
          tokenVersion: user.tokenVersion + 1,
        });

        res.json({ success: true });
      } catch (error) {
        console.error("Logout error:", error);
        res.status(500).json({ error: "Failed to logout" });
      }
    },
  );

  app.get("/api/auth/me", requireAuth, async (req: Request, res: Response) => {
    const user = await storage.getUser(req.userId!);
    if (!user) {
      return res.status(401).json({ error: "User not found" });
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
          return res.status(400).json({ error: "No valid fields to update" });
        }

        const user = await storage.updateUser(req.userId!, updates);

        if (!user) {
          return res.status(404).json({ error: "User not found" });
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
          return res.status(400).json({ error: formatZodError(error) });
        }
        console.error("Profile update error:", error);
        res.status(500).json({ error: "Failed to update profile" });
      }
    },
  );

  // Avatar upload endpoint - converts image to base64 data URL
  app.post(
    "/api/user/avatar",
    requireAuth,
    avatarRateLimit,
    upload.single("avatar"),
    async (req: Request, res: Response) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: "No image provided" });
        }

        // Convert to base64 data URL (stored directly in DB for simplicity)
        const base64 = req.file.buffer.toString("base64");
        const mimeType = req.file.mimetype;
        const dataUrl = `data:${mimeType};base64,${base64}`;

        // Limit size check (already handled by multer, but double-check data URL)
        if (dataUrl.length > 1.5 * 1024 * 1024) {
          return res
            .status(400)
            .json({ error: "Image too large after encoding" });
        }

        const user = await storage.updateUser(req.userId!, {
          avatarUrl: dataUrl,
        });

        if (!user) {
          return res.status(404).json({ error: "User not found" });
        }

        res.json({
          avatarUrl: user.avatarUrl,
        });
      } catch (error) {
        console.error("Avatar upload error:", error);
        res.status(500).json({ error: "Failed to upload avatar" });
      }
    },
  );

  // Avatar delete endpoint
  app.delete(
    "/api/user/avatar",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const user = await storage.updateUser(req.userId!, {
          avatarUrl: null,
        });

        if (!user) {
          return res.status(404).json({ error: "User not found" });
        }

        res.json({ success: true });
      } catch (error) {
        console.error("Avatar delete error:", error);
        res.status(500).json({ error: "Failed to delete avatar" });
      }
    },
  );
}
