import type { Express, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import {
  checkPremiumFeature,
  formatZodError,
  handleRouteError,
  parsePositiveIntParam,
  parseQueryInt,
} from "./_helpers";
import {
  cookbookCoverCandidatesRateLimit,
  cookbookCoverGenerateRateLimit,
  cookbookCoverUploadRateLimit,
  crudRateLimit,
} from "./_rate-limiters";
import { createImageUpload } from "./_upload";
import { deleteImage, saveCookbookCover } from "../lib/image-store";
import { detectImageMimeType } from "../lib/image-mime";
import { fireAndForget } from "../lib/fire-and-forget";
import {
  CoverPrePassError,
  generateCookbookCover,
  generateCoverCandidates,
} from "../services/cookbook-cover";
import { isArtDirectorLLMEnabled } from "../services/image-art-direction";
import { isRunwareConfigured } from "../lib/runware";
import {
  COOKBOOK_COVER_PROMPT_MAX,
  COOKBOOK_COVER_STYLES,
} from "@shared/constants/cookbook-cover-styles";
import { createServiceLogger, toError } from "../lib/logger";

const log = createServiceLogger("cookbooks-routes");

// Covers are larger than avatars (they render full-bleed at book proportion),
// so the cap is 2MB against the avatar path's 1MB. The client compresses
// before upload; this is the backstop.
const coverUpload = createImageUpload(2 * 1024 * 1024);

// `coverImageUrl` is deliberately NOT accepted from the request body. It is
// set only by the two /cover endpoints below, from a server-minted key.
//
// This matters beyond "no client sends it": the stored value is now read back
// and passed to `deleteImage(..., "cookbook")` on the delete/replace paths, so
// an accepted body field would let a user point their own cookbook at ANOTHER
// user's cover key and have the server delete that object. The prefix guard in
// `deleteImage` only scopes to `cookbook-covers/`, which is where every user's
// covers live — it blocks cross-KIND deletion, not cross-USER. Removing the
// field closes that, and also fixes an orphan leak (a PATCH overwriting the
// URL abandoned the previous object with no cleanup).
const createCookbookSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  description: z.string().max(1000).optional().nullable(),
});

const updateCookbookSchema = createCookbookSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided for update",
  });

const coverCandidatesSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().max(1000).optional().nullable(),
    coverPrompt: z.string().max(COOKBOOK_COVER_PROMPT_MAX).optional(),
    style: z.enum(COOKBOOK_COVER_STYLES),
  })
  .strict();

// An id, never a URL — see the comment above createCookbookSchema.
const attachCandidateSchema = z
  .object({ candidateId: z.string().uuid() })
  .strict();

/** Stored cover-studio sets a user may make in any rolling 24 hours. */
const COVER_SETS_PER_DAY = 15;
/** Fewer images than this don't replace the user's current set. */
const MIN_COVER_CANDIDATES = 2;

const addRecipeSchema = z.object({
  recipeId: z.number().int().positive(),
  recipeType: z.enum(["mealPlan", "community"]).default("mealPlan"),
});

/**
 * Best-effort removal of an object we just stored but failed to point the DB
 * at. The request is already failing 404, so a cleanup failure must not turn
 * it into a 500 — but it must not be silent either: a swallowed R2 delete
 * leaves an orphaned object with no trace that bucket state and the DB have
 * diverged. (`deleteImage`'s disk branch swallows its own unlink errors, so
 * this catch's real blast radius is R2.)
 */
async function rollbackStoredCover(
  url: string,
  cookbookId: number,
  source: "upload" | "generate" | "candidate",
): Promise<void> {
  try {
    await deleteImage(url, "cookbook");
  } catch (error) {
    log.error(
      { err: toError(error), cookbookId, source, url },
      "cookbook cover rollback cleanup failed — object may be orphaned",
    );
  }
}

export function register(app: Express): void {
  // GET /api/cookbooks — List user's cookbooks
  app.get(
    "/api/cookbooks",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const limit = parseQueryInt(req.query.limit, {
          default: 50,
          max: 100,
        });
        const cookbooks = await storage.getUserCookbooks(req.userId, limit);
        res.json(cookbooks);
      } catch (error) {
        handleRouteError(res, error, "fetch cookbooks");
      }
    },
  );

  // POST /api/cookbooks — Create cookbook
  app.post(
    "/api/cookbooks",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const parsed = createCookbookSchema.safeParse(req.body);
        if (!parsed.success) {
          sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        const cookbook = await storage.createCookbook({
          userId: req.userId,
          name: parsed.data.name,
          description: parsed.data.description || null,
          // A cookbook is always created without a cover; the client attaches
          // one afterwards via POST /api/cookbooks/:id/cover[/generate].
          coverImageUrl: null,
        });
        res.status(201).json(cookbook);
      } catch (error) {
        handleRouteError(res, error, "create cookbook");
      }
    },
  );

  // GET /api/cookbooks/:id — Get single cookbook with recipes
  app.get(
    "/api/cookbooks/:id",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const id = parsePositiveIntParam(req.params.id);
        if (!id) {
          sendError(
            res,
            400,
            "Invalid cookbook ID",
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        const cookbook = await storage.getCookbook(id, req.userId);
        if (!cookbook) {
          sendError(res, 404, "Cookbook not found", ErrorCode.NOT_FOUND);
          return;
        }

        const recipes = await storage.getResolvedCookbookRecipes(
          id,
          req.userId,
        );
        res.json({ ...cookbook, recipes });
      } catch (error) {
        handleRouteError(res, error, "fetch cookbook");
      }
    },
  );

  // PATCH /api/cookbooks/:id — Update cookbook
  app.patch(
    "/api/cookbooks/:id",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const id = parsePositiveIntParam(req.params.id);
        if (!id) {
          sendError(
            res,
            400,
            "Invalid cookbook ID",
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        const parsed = updateCookbookSchema.safeParse(req.body);
        if (!parsed.success) {
          sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        const updated = await storage.updateCookbook(
          id,
          req.userId,
          parsed.data,
        );
        if (!updated) {
          sendError(res, 404, "Cookbook not found", ErrorCode.NOT_FOUND);
          return;
        }
        res.json(updated);
      } catch (error) {
        handleRouteError(res, error, "update cookbook");
      }
    },
  );

  // DELETE /api/cookbooks/:id — Delete cookbook
  app.delete(
    "/api/cookbooks/:id",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const id = parsePositiveIntParam(req.params.id);
        if (!id) {
          sendError(
            res,
            400,
            "Invalid cookbook ID",
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        // Read the cover URL before the row goes away — the stored object is
        // cleaned up after responding.
        const existing = await storage.getCookbook(id, req.userId);
        const deleted = await storage.deleteCookbook(id, req.userId);
        if (!deleted) {
          sendError(res, 404, "Cookbook not found", ErrorCode.NOT_FOUND);
          return;
        }
        res.status(204).send();

        // Fire-and-forget: the row is already gone, so a storage cleanup
        // failure must not affect the response or add R2 latency to it.
        fireAndForget(
          "cookbook-cover-delete-cleanup",
          deleteImage(existing?.coverImageUrl, "cookbook"),
        );
      } catch (error) {
        handleRouteError(res, error, "delete cookbook");
      }
    },
  );

  // POST /api/cookbooks/:id/cover — Upload a cover image (not premium-gated)
  app.post(
    "/api/cookbooks/:id/cover",
    requireAuth,
    cookbookCoverUploadRateLimit,
    coverUpload.single("cover"),
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const id = parsePositiveIntParam(req.params.id);
        if (!id) {
          sendError(
            res,
            400,
            "Invalid cookbook ID",
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        if (!req.file) {
          sendError(res, 400, "No image provided", ErrorCode.VALIDATION_ERROR);
          return;
        }

        // Validate actual file content via magic bytes — the client-supplied
        // mimetype that multer's fileFilter saw is not trustworthy.
        const detectedMime = detectImageMimeType(req.file.buffer);
        if (!detectedMime) {
          sendError(
            res,
            400,
            "Invalid image content. Only JPEG, PNG, and WebP allowed.",
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        // Ownership check before spending an upload: getCookbook is scoped by
        // userId, so another user's cookbook is indistinguishable from a
        // missing one.
        const existing = await storage.getCookbook(id, req.userId);
        if (!existing) {
          sendError(res, 404, "Cookbook not found", ErrorCode.NOT_FOUND);
          return;
        }

        const ext =
          detectedMime === "image/jpeg"
            ? "jpg"
            : detectedMime === "image/png"
              ? "png"
              : "webp";
        const coverImageUrl = await saveCookbookCover(req.file.buffer, ext);

        const updated = await storage.updateCookbook(id, req.userId, {
          coverImageUrl,
        });
        if (!updated) {
          // Best-effort rollback of the just-uploaded object; the request
          // already fails 404, so a cleanup failure must not make it a 500.
          await rollbackStoredCover(coverImageUrl, id, "upload");
          sendError(res, 404, "Cookbook not found", ErrorCode.NOT_FOUND);
          return;
        }

        res.json(updated);

        // Replaced cover is cleaned up after responding — the DB already
        // points at the new object, so a storage failure is not user-visible.
        fireAndForget(
          "cookbook-cover-upload-cleanup",
          deleteImage(existing.coverImageUrl, "cookbook"),
        );
      } catch (error) {
        handleRouteError(res, error, "upload cookbook cover");
      }
    },
  );

  // POST /api/cookbooks/:id/cover/generate — AI-generate a cover (premium)
  app.post(
    "/api/cookbooks/:id/cover/generate",
    requireAuth,
    cookbookCoverGenerateRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const id = parsePositiveIntParam(req.params.id);
        if (!id) {
          sendError(
            res,
            400,
            "Invalid cookbook ID",
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        const features = await checkPremiumFeature(
          req,
          res,
          "cookbookCoverGeneration",
          "Cover generation",
        );
        if (!features) return;

        const existing = await storage.getCookbook(id, req.userId);
        if (!existing) {
          sendError(res, 404, "Cookbook not found", ErrorCode.NOT_FOUND);
          return;
        }

        // The prompt is derived from the cookbook's stored name and
        // description, never the request body. Both are still user text: what
        // keeps them off the image model is the pre-pass and its output gates
        // in `deriveCoverSubject`, not the fact they were saved first.
        const coverImageUrl = await generateCookbookCover(
          existing.name,
          existing.description,
        );
        if (!coverImageUrl) {
          // Distinct from AI_NOT_CONFIGURED: this path is reached when a
          // provider was configured but the attempt failed (or persistence
          // did), which is retryable. Conflating the two makes an R2 outage
          // read as a missing API key in monitoring, and tells the user a
          // transient blip is a permanent capability gap.
          sendError(
            res,
            503,
            "Couldn't generate a cover right now. Please try again.",
            ErrorCode.IMAGE_GENERATION_FAILED,
          );
          return;
        }

        const updated = await storage.updateCookbook(id, req.userId, {
          coverImageUrl,
        });
        if (!updated) {
          await rollbackStoredCover(coverImageUrl, id, "generate");
          sendError(res, 404, "Cookbook not found", ErrorCode.NOT_FOUND);
          return;
        }

        res.json(updated);

        // Distinct label per path: a cleanup failure after a PAID generation
        // is a different severity than after a free upload.
        fireAndForget(
          "cookbook-cover-generate-cleanup",
          deleteImage(existing.coverImageUrl, "cookbook"),
        );
      } catch (error) {
        handleRouteError(res, error, "generate cookbook cover");
      }
    },
  );

  // POST /api/cookbook-covers/candidates — the cover studio: generate a set of
  // candidate covers before the cookbook exists (premium). The user's
  // `coverPrompt` reaches the image model only through the gated pre-pass in
  // `generateCoverCandidates`.
  app.post(
    "/api/cookbook-covers/candidates",
    requireAuth,
    cookbookCoverCandidatesRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const parsed = coverCandidatesSchema.safeParse(req.body);
        if (!parsed.success) {
          sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        const features = await checkPremiumFeature(
          req,
          res,
          "cookbookCoverGeneration",
          "Cover generation",
        );
        if (!features) return;

        // With the pre-pass off, the studio would pay for four generic covers
        // that ignore what the user asked for — refuse instead.
        if (!isRunwareConfigured || !isArtDirectorLLMEnabled()) {
          sendError(
            res,
            503,
            "Cover generation isn't available right now.",
            ErrorCode.AI_NOT_CONFIGURED,
          );
          return;
        }

        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        if (
          (await storage.countCoverSetsSince(req.userId, since)) >=
          COVER_SETS_PER_DAY
        ) {
          sendError(
            res,
            429,
            "You've made a lot of covers today. Try again tomorrow.",
            ErrorCode.DAILY_LIMIT_REACHED,
          );
          return;
        }

        let generated: Awaited<ReturnType<typeof generateCoverCandidates>>;
        try {
          generated = await generateCoverCandidates({
            name: parsed.data.name,
            description: parsed.data.description,
            coverPrompt: parsed.data.coverPrompt,
            style: parsed.data.style,
          });
        } catch (error) {
          if (error instanceof CoverPrePassError) {
            sendError(
              res,
              503,
              "Couldn't make covers right now. Please try again.",
              ErrorCode.AI_UNAVAILABLE,
            );
            return;
          }
          throw error;
        }

        if (generated.buffers.length < MIN_COVER_CANDIDATES) {
          sendError(
            res,
            503,
            "Couldn't make covers right now. Please try again.",
            ErrorCode.IMAGE_GENERATION_FAILED,
          );
          return;
        }

        // Saved one at a time so a failed save leaves a known list to remove:
        // until the set is stored, no row points at these objects and the
        // purge would never find them.
        const savedUrls: string[] = [];
        let stored: Awaited<ReturnType<typeof storage.storeCoverCandidateSet>>;
        try {
          for (const buffer of generated.buffers) {
            savedUrls.push(await saveCookbookCover(buffer, "jpg"));
          }
          stored = await storage.storeCoverCandidateSet(req.userId, savedUrls);
        } catch (error) {
          for (const url of savedUrls) {
            fireAndForget(
              "cookbook-cover-candidates-save-cleanup",
              deleteImage(url, "cookbook"),
            );
          }
          throw error;
        }

        res.json({
          candidates: stored.candidates,
          expiresAt: stored.expiresAt,
          promptIgnored: generated.promptIgnored,
        });

        for (const url of stored.replacedUrls) {
          fireAndForget(
            "cookbook-cover-candidates-replace-cleanup",
            deleteImage(url, "cookbook"),
          );
        }
      } catch (error) {
        handleRouteError(res, error, "generate cookbook cover candidates");
      }
    },
  );

  // POST /api/cookbooks/:id/cover/candidate — attach a picked studio cover.
  // Not premium-gated: a candidate only exists if the premium gate passed in
  // its 2-hour life, and attaching spends nothing.
  app.post(
    "/api/cookbooks/:id/cover/candidate",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const id = parsePositiveIntParam(req.params.id);
        if (!id) {
          sendError(
            res,
            400,
            "Invalid cookbook ID",
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        const parsed = attachCandidateSchema.safeParse(req.body);
        if (!parsed.success) {
          sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        const existing = await storage.getCookbook(id, req.userId);
        if (!existing) {
          sendError(res, 404, "Cookbook not found", ErrorCode.NOT_FOUND);
          return;
        }

        // The same answer for an expired id, an unknown id, and another
        // user's id — the claim is scoped to req.userId in its own SQL.
        const coverImageUrl = await storage.claimCoverCandidate(
          parsed.data.candidateId,
          req.userId,
        );
        if (!coverImageUrl) {
          sendError(
            res,
            410,
            "That cover has expired. Generate a new one.",
            ErrorCode.COVER_CANDIDATE_EXPIRED,
          );
          return;
        }

        const updated = await storage.updateCookbook(id, req.userId, {
          coverImageUrl,
        });
        if (!updated) {
          await rollbackStoredCover(coverImageUrl, id, "candidate");
          sendError(res, 404, "Cookbook not found", ErrorCode.NOT_FOUND);
          return;
        }

        res.json(updated);

        fireAndForget(
          "cookbook-cover-candidate-cleanup",
          deleteImage(existing.coverImageUrl, "cookbook"),
        );
      } catch (error) {
        handleRouteError(res, error, "attach cookbook cover candidate");
      }
    },
  );

  // POST /api/cookbooks/:id/recipes — Add recipe to cookbook
  app.post(
    "/api/cookbooks/:id/recipes",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const id = parsePositiveIntParam(req.params.id);
        if (!id) {
          sendError(
            res,
            400,
            "Invalid cookbook ID",
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        // Verify ownership
        const cookbook = await storage.getCookbook(id, req.userId);
        if (!cookbook) {
          sendError(res, 404, "Cookbook not found", ErrorCode.NOT_FOUND);
          return;
        }

        const parsed = addRecipeSchema.safeParse(req.body);
        if (!parsed.success) {
          sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        const added = await storage.addRecipeToCookbook(
          id,
          parsed.data.recipeId,
          parsed.data.recipeType,
          req.userId,
        );
        if (!added) {
          sendError(
            res,
            409,
            "Recipe already exists in this cookbook",
            ErrorCode.CONFLICT,
          );
          return;
        }
        res.status(201).json(added);
      } catch (error) {
        handleRouteError(res, error, "add recipe to cookbook");
      }
    },
  );

  // DELETE /api/cookbooks/:id/recipes/:recipeId — Remove recipe from cookbook
  app.delete(
    "/api/cookbooks/:id/recipes/:recipeId",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const id = parsePositiveIntParam(req.params.id);
        const recipeId = parsePositiveIntParam(req.params.recipeId);
        if (!id || !recipeId) {
          sendError(
            res,
            400,
            "Invalid cookbook or recipe ID",
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        // Verify ownership
        const cookbook = await storage.getCookbook(id, req.userId);
        if (!cookbook) {
          sendError(res, 404, "Cookbook not found", ErrorCode.NOT_FOUND);
          return;
        }

        const recipeTypeParsed = z
          .enum(["mealPlan", "community"])
          .default("mealPlan")
          .safeParse(req.query.recipeType);
        if (!recipeTypeParsed.success) {
          sendError(res, 400, "Invalid recipeType", ErrorCode.VALIDATION_ERROR);
          return;
        }
        const recipeType = recipeTypeParsed.data;

        const removed = await storage.removeRecipeFromCookbook(
          id,
          recipeId,
          recipeType,
          req.userId,
        );
        if (!removed) {
          sendError(
            res,
            404,
            "Recipe not found in cookbook",
            ErrorCode.NOT_FOUND,
          );
          return;
        }
        res.status(204).send();
      } catch (error) {
        handleRouteError(res, error, "remove recipe from cookbook");
      }
    },
  );
}
