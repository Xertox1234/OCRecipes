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
  cookbookCoverGenerateRateLimit,
  cookbookCoverUploadRateLimit,
  crudRateLimit,
} from "./_rate-limiters";
import { createImageUpload } from "./_upload";
import { deleteImage, saveCookbookCover } from "../lib/image-store";
import { detectImageMimeType } from "../lib/image-mime";
import { fireAndForget } from "../lib/fire-and-forget";
import { generateCookbookCover } from "../services/cookbook-cover";

// Covers are larger than avatars (they render full-bleed at book proportion),
// so the cap is 2MB against the avatar path's 1MB. The client compresses
// before upload; this is the backstop.
const coverUpload = createImageUpload(2 * 1024 * 1024);

const createCookbookSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  description: z.string().max(1000).optional().nullable(),
  coverImageUrl: z
    .string()
    .url()
    .max(2000)
    .refine(
      (url) => /^https?:\/\//.test(url),
      "Only http:// or https:// URLs allowed",
    )
    .optional()
    .nullable(),
});

const updateCookbookSchema = createCookbookSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided for update",
  });

const addRecipeSchema = z.object({
  recipeId: z.number().int().positive(),
  recipeType: z.enum(["mealPlan", "community"]).default("mealPlan"),
});

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
          coverImageUrl: parsed.data.coverImageUrl || null,
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
          await deleteImage(coverImageUrl, "cookbook").catch(() => {});
          sendError(res, 404, "Cookbook not found", ErrorCode.NOT_FOUND);
          return;
        }

        res.json(updated);

        // Replaced cover is cleaned up after responding — the DB already
        // points at the new object, so a storage failure is not user-visible.
        fireAndForget(
          "old-cookbook-cover-cleanup",
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

        // The prompt is built from the cookbook's OWN stored name and
        // description, never from the request body — the client cannot steer
        // the image prompt beyond what it already saved.
        const coverImageUrl = await generateCookbookCover(
          existing.name,
          existing.description,
        );
        if (!coverImageUrl) {
          sendError(
            res,
            503,
            "Couldn't generate a cover right now. Please try again.",
            ErrorCode.AI_NOT_CONFIGURED,
          );
          return;
        }

        const updated = await storage.updateCookbook(id, req.userId, {
          coverImageUrl,
        });
        if (!updated) {
          await deleteImage(coverImageUrl, "cookbook").catch(() => {});
          sendError(res, 404, "Cookbook not found", ErrorCode.NOT_FOUND);
          return;
        }

        res.json(updated);

        fireAndForget(
          "old-cookbook-cover-cleanup",
          deleteImage(existing.coverImageUrl, "cookbook"),
        );
      } catch (error) {
        handleRouteError(res, error, "generate cookbook cover");
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
