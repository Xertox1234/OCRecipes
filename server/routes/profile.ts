import type { Express, Request, Response } from "express";
import { ZodError } from "zod";
import { eq } from "drizzle-orm";
import { storage } from "../storage";
import { db } from "../db";
import { requireAuth } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { userProfiles, users } from "@shared/schema";
import {
  formatZodError,
  userProfileInputSchema,
  crudRateLimit,
} from "./_helpers";

// Fields that affect AI-generated suggestions - if any change, invalidate cache
const cacheAffectingFields = [
  "allergies",
  "dietType",
  "cookingSkillLevel",
  "cookingTimeAvailable",
];

export function register(app: Express): void {
  app.get(
    "/api/user/dietary-profile",
    requireAuth,
    crudRateLimit,
    async (req: Request, res: Response) => {
      try {
        const profile = await storage.getUserProfile(req.userId!);
        res.json(profile || null);
      } catch (error) {
        console.error("Error fetching dietary profile:", error);
        sendError(
          res,
          500,
          "Failed to fetch dietary profile",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  app.post(
    "/api/user/dietary-profile",
    requireAuth,
    crudRateLimit,
    async (req: Request, res: Response) => {
      try {
        const validated = userProfileInputSchema.parse({
          ...req.body,
          userId: req.userId!,
        });

        const profileData = {
          allergies: validated.allergies,
          healthConditions: validated.healthConditions,
          dietType: validated.dietType,
          foodDislikes: validated.foodDislikes,
          primaryGoal: validated.primaryGoal,
          activityLevel: validated.activityLevel,
          householdSize: validated.householdSize,
          cuisinePreferences: validated.cuisinePreferences,
          cookingSkillLevel: validated.cookingSkillLevel,
          cookingTimeAvailable: validated.cookingTimeAvailable,
        };

        // Transaction: create/update profile + mark onboarding complete
        const profile = await db.transaction(async (tx) => {
          const [existing] = await tx
            .select()
            .from(userProfiles)
            .where(eq(userProfiles.userId, req.userId!));

          let result;
          if (existing) {
            [result] = await tx
              .update(userProfiles)
              .set({ ...profileData, updatedAt: new Date() })
              .where(eq(userProfiles.userId, req.userId!))
              .returning();
          } else {
            [result] = await tx
              .insert(userProfiles)
              .values({ ...profileData, userId: req.userId! })
              .returning();
          }

          await tx
            .update(users)
            .set({ onboardingCompleted: true })
            .where(eq(users.id, req.userId!));

          return result;
        });

        res.status(201).json(profile);
      } catch (error) {
        if (error instanceof ZodError) {
          return sendError(
            res,
            400,
            formatZodError(error),
            ErrorCode.VALIDATION_ERROR,
          );
        }
        console.error("Error saving dietary profile:", error);
        sendError(
          res,
          500,
          "Failed to save dietary profile",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  app.put(
    "/api/user/dietary-profile",
    requireAuth,
    crudRateLimit,
    async (req: Request, res: Response) => {
      try {
        // For partial updates, make all fields optional
        const updateSchema = userProfileInputSchema
          .partial()
          .omit({ userId: true });
        const validated = updateSchema.parse(req.body);

        const profile = await storage.updateUserProfile(req.userId!, validated);

        if (!profile) {
          return sendError(res, 404, "Profile not found", ErrorCode.NOT_FOUND);
        }

        // Invalidate suggestion cache if dietary-affecting fields changed
        // Fire-and-forget: don't block the response on cache invalidation
        const changedCacheFields = cacheAffectingFields.some(
          (f) => f in validated,
        );
        if (changedCacheFields) {
          storage
            .invalidateSuggestionCacheForUser(req.userId!)
            .catch(console.error);
        }

        res.json(profile);
      } catch (error) {
        if (error instanceof ZodError) {
          return sendError(
            res,
            400,
            formatZodError(error),
            ErrorCode.VALIDATION_ERROR,
          );
        }
        console.error("Error updating dietary profile:", error);
        sendError(
          res,
          500,
          "Failed to update dietary profile",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );
}
