import type { Express, Response } from "express";
import { z, ZodError } from "zod";
import { storage } from "../storage";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import {
  MAX_FAMILY_PROFILES,
  familyProfileInputSchema,
  type FamilyProfileInput,
} from "@shared/types/family";
import {
  checkPremiumFeature,
  formatZodError,
  handleRouteError,
  parsePositiveIntParam,
} from "./_helpers";
import { hasHealthConsent, sendHealthConsentRequired } from "./_health-consent";
import { familyRateLimit } from "./_rate-limiters";

const familyPlanningSchema = z.object({ enabled: z.boolean() });

/**
 * A failed Drizzle statement's message ends with "\nparams:" followed by every
 * bound value, and its `cause` (the pg error) can quote a rejected input. For a
 * profile write those values are another person's name, allergies and note, and
 * the log line carries the user id beside them. Keep which statement failed;
 * drop the values and the cause before the error reaches the logger. Sentry is
 * scrubbed separately (`scrubEvent`); this covers the server log.
 */
function withoutBoundValues(error: unknown): unknown {
  if (!(error instanceof Error) || error instanceof ZodError) return error;
  const paramsStart = error.message.indexOf("\nparams:");
  if (paramsStart === -1 && error.cause === undefined) return error;
  const safe = new Error(
    paramsStart === -1 ? error.message : error.message.slice(0, paramsStart),
  );
  safe.name = error.name;
  return safe;
}

/** Allergies and a note are health details: they need the health-data consent. */
function hasHealthDetails(input: FamilyProfileInput): boolean {
  return input.allergies.length > 0 || input.note !== null;
}

export function register(app: Express): void {
  // GET /api/family-profiles — not premium-gated: a lapsed user can still
  // list (and delete) their profiles.
  app.get(
    "/api/family-profiles",
    requireAuth,
    familyRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const [userProfile, profiles] = await Promise.all([
          storage.getUserProfile(req.userId),
          storage.getFamilyProfiles(req.userId),
        ]);
        res.json({
          enabled: userProfile?.familyPlanningEnabled ?? false,
          profiles,
        });
      } catch (error) {
        handleRouteError(res, error, "fetch family profiles");
      }
    },
  );

  app.post(
    "/api/family-profiles",
    requireAuth,
    familyRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "familyProfiles",
          "Family profiles",
        );
        if (!features) return;

        const parsed = familyProfileInputSchema.safeParse(req.body);
        if (!parsed.success) {
          sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }
        if (
          hasHealthDetails(parsed.data) &&
          !(await hasHealthConsent(req.userId))
        ) {
          sendHealthConsentRequired(res);
          return;
        }

        const created = await storage.createFamilyProfile(
          req.userId,
          parsed.data,
        );
        if (created === "limit") {
          sendError(
            res,
            409,
            `You can add up to ${MAX_FAMILY_PROFILES} family profiles`,
            ErrorCode.LIMIT_REACHED,
          );
          return;
        }
        res.status(201).json(created);
      } catch (error) {
        handleRouteError(
          res,
          withoutBoundValues(error),
          "create family profile",
        );
      }
    },
  );

  app.put(
    "/api/family-profiles/:id",
    requireAuth,
    familyRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "familyProfiles",
          "Family profiles",
        );
        if (!features) return;

        const id = parsePositiveIntParam(req.params.id);
        if (id === null) {
          sendError(
            res,
            400,
            "Invalid family profile ID",
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }
        const parsed = familyProfileInputSchema.safeParse(req.body);
        if (!parsed.success) {
          sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }
        if (
          hasHealthDetails(parsed.data) &&
          !(await hasHealthConsent(req.userId))
        ) {
          sendHealthConsentRequired(res);
          return;
        }

        const updated = await storage.updateFamilyProfile(
          id,
          req.userId,
          parsed.data,
        );
        if (!updated) {
          sendError(res, 404, "Family profile not found", ErrorCode.NOT_FOUND);
          return;
        }
        res.json(updated);
      } catch (error) {
        handleRouteError(
          res,
          withoutBoundValues(error),
          "update family profile",
        );
      }
    },
  );

  // DELETE — not premium-gated: a lapsed user must be able to clean up.
  app.delete(
    "/api/family-profiles/:id",
    requireAuth,
    familyRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const id = parsePositiveIntParam(req.params.id);
        if (id === null) {
          sendError(
            res,
            400,
            "Invalid family profile ID",
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }
        const deleted = await storage.deleteFamilyProfile(id, req.userId);
        if (!deleted) {
          sendError(res, 404, "Family profile not found", ErrorCode.NOT_FOUND);
          return;
        }
        res.status(204).send();
      } catch (error) {
        handleRouteError(res, error, "delete family profile");
      }
    },
  );

  // PUT /api/family-planning — the switch. Turning it on needs the premium
  // flag; turning it off never does.
  app.put(
    "/api/family-planning",
    requireAuth,
    familyRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const parsed = familyPlanningSchema.safeParse(req.body);
        if (!parsed.success) {
          sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }
        if (parsed.data.enabled) {
          const features = await checkPremiumFeature(
            req,
            res,
            "familyProfiles",
            "Family planning",
          );
          if (!features) return;
        }
        const enabled = await storage.setFamilyPlanningEnabled(
          req.userId,
          parsed.data.enabled,
        );
        res.json({ enabled });
      } catch (error) {
        handleRouteError(res, error, "update family planning");
      }
    },
  );
}
