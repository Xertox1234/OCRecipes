import type { Express, Response } from "express";
import { storage } from "../storage";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { logger, toError } from "../lib/logger";
import { fireAndForget } from "../lib/fire-and-forget";
import { ErrorCode } from "@shared/constants/error-codes";
import { crudRateLimit } from "./_rate-limiters";
import { userProfileInputSchema } from "./_schemas";
import { handleRouteError } from "./_helpers";

// Fields that affect AI-generated suggestions - if any change, invalidate cache
const cacheAffectingFields = [
  "allergies",
  "dietType",
  "cookingSkillLevel",
  "cookingTimeAvailable",
  "foodDislikes",
  "cuisinePreferences",
];

export function register(app: Express): void {
  app.get(
    "/api/user/dietary-profile",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const profile = await storage.getUserProfile(req.userId);
        res.json(profile || null);
      } catch (error) {
        logger.error({ err: toError(error) }, "error fetching dietary profile");
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
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const validated = userProfileInputSchema.parse({
          ...req.body,
          userId: req.userId,
        });

        // Consent is append-only and server-stamped. The route translates the
        // client's `healthDataConsent: true` intent into `new Date()` server-side;
        // clients cannot supply, backdate, or clear `healthDataConsentAt`. Omitting
        // the field when the flag is absent preserves any previously recorded
        // consent timestamp (storage layer ignores `undefined`).
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
          ...(validated.healthDataConsent === true
            ? { healthDataConsentAt: new Date() }
            : {}),
        };

        // Upsert profile + mark onboarding complete atomically
        const profile = await storage.upsertProfileWithOnboarding(
          req.userId,
          profileData,
        );

        res.status(201).json(profile);
      } catch (error) {
        handleRouteError(res, error, "save dietary profile");
      }
    },
  );

  app.put(
    "/api/user/dietary-profile",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        // For partial updates, make all fields optional
        const updateSchema = userProfileInputSchema
          .partial()
          .omit({ userId: true });
        const validated = updateSchema.parse(req.body);

        // `healthDataConsent` is a transient intent flag, not a storage column.
        // Translate to a server-stamped `healthDataConsentAt` only when the user
        // is granting consent for the first time — append-only, so we never
        // clear or overwrite an existing timestamp via this PUT path.
        const { healthDataConsent, ...updates } = validated;
        const updatesWithConsent =
          healthDataConsent === true
            ? { ...updates, healthDataConsentAt: new Date() }
            : updates;

        const profile = await storage.updateUserProfile(
          req.userId,
          updatesWithConsent,
        );

        if (!profile) {
          return sendError(res, 404, "Profile not found", ErrorCode.NOT_FOUND);
        }

        // Invalidate suggestion cache if dietary-affecting fields changed
        // Fire-and-forget: don't block the response on cache invalidation
        const changedCacheFields = cacheAffectingFields.some(
          (f) => f in validated,
        );
        if (changedCacheFields) {
          fireAndForget(
            "suggestion-cache-invalidation",
            storage.invalidateSuggestionCacheForUser(req.userId),
          );
        }

        res.json(profile);
      } catch (error) {
        handleRouteError(res, error, "update dietary profile");
      }
    },
  );
}
