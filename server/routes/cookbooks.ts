import type { Express, Request, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAuth } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import {
  crudRateLimit,
  formatZodError,
  parsePositiveIntParam,
  parseQueryInt,
} from "./_helpers";

const createCookbookSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  description: z.string().max(1000).optional().nullable(),
  coverImageUrl: z.string().url().max(2000).optional().nullable(),
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
    async (req: Request, res: Response): Promise<void> => {
      try {
        const limit = parseQueryInt(req.query.limit, {
          default: 50,
          max: 100,
        });
        const cookbooks = await storage.getUserCookbooks(req.userId!, limit);
        res.json(cookbooks);
      } catch (error) {
        console.error("Get cookbooks error:", error);
        sendError(
          res,
          500,
          "Failed to fetch cookbooks",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // POST /api/cookbooks — Create cookbook
  app.post(
    "/api/cookbooks",
    requireAuth,
    crudRateLimit,
    async (req: Request, res: Response): Promise<void> => {
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
          userId: req.userId!,
          name: parsed.data.name,
          description: parsed.data.description || null,
          coverImageUrl: parsed.data.coverImageUrl || null,
        });
        res.status(201).json(cookbook);
      } catch (error) {
        console.error("Create cookbook error:", error);
        sendError(
          res,
          500,
          "Failed to create cookbook",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // GET /api/cookbooks/:id — Get single cookbook with recipes
  app.get(
    "/api/cookbooks/:id",
    requireAuth,
    crudRateLimit,
    async (req: Request, res: Response): Promise<void> => {
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

        const cookbook = await storage.getCookbook(id, req.userId!);
        if (!cookbook) {
          sendError(res, 404, "Cookbook not found", ErrorCode.NOT_FOUND);
          return;
        }

        const recipes = await storage.getCookbookRecipes(id);
        res.json({ ...cookbook, recipes });
      } catch (error) {
        console.error("Get cookbook error:", error);
        sendError(
          res,
          500,
          "Failed to fetch cookbook",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // PATCH /api/cookbooks/:id — Update cookbook
  app.patch(
    "/api/cookbooks/:id",
    requireAuth,
    crudRateLimit,
    async (req: Request, res: Response): Promise<void> => {
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
          req.userId!,
          parsed.data,
        );
        if (!updated) {
          sendError(res, 404, "Cookbook not found", ErrorCode.NOT_FOUND);
          return;
        }
        res.json(updated);
      } catch (error) {
        console.error("Update cookbook error:", error);
        sendError(
          res,
          500,
          "Failed to update cookbook",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // DELETE /api/cookbooks/:id — Delete cookbook
  app.delete(
    "/api/cookbooks/:id",
    requireAuth,
    crudRateLimit,
    async (req: Request, res: Response): Promise<void> => {
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

        const deleted = await storage.deleteCookbook(id, req.userId!);
        if (!deleted) {
          sendError(res, 404, "Cookbook not found", ErrorCode.NOT_FOUND);
          return;
        }
        res.status(204).send();
      } catch (error) {
        console.error("Delete cookbook error:", error);
        sendError(
          res,
          500,
          "Failed to delete cookbook",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // POST /api/cookbooks/:id/recipes — Add recipe to cookbook
  app.post(
    "/api/cookbooks/:id/recipes",
    requireAuth,
    crudRateLimit,
    async (req: Request, res: Response): Promise<void> => {
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
        const cookbook = await storage.getCookbook(id, req.userId!);
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
        );
        if (!added) {
          sendError(
            res,
            409,
            "Recipe already exists in this cookbook",
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }
        res.status(201).json(added);
      } catch (error) {
        console.error("Add recipe to cookbook error:", error);
        sendError(
          res,
          500,
          "Failed to add recipe to cookbook",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // DELETE /api/cookbooks/:id/recipes/:recipeId — Remove recipe from cookbook
  app.delete(
    "/api/cookbooks/:id/recipes/:recipeId",
    requireAuth,
    crudRateLimit,
    async (req: Request, res: Response): Promise<void> => {
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
        const cookbook = await storage.getCookbook(id, req.userId!);
        if (!cookbook) {
          sendError(res, 404, "Cookbook not found", ErrorCode.NOT_FOUND);
          return;
        }

        const recipeType =
          typeof req.query.recipeType === "string"
            ? req.query.recipeType
            : "mealPlan";

        const removed = await storage.removeRecipeFromCookbook(
          id,
          recipeId,
          recipeType,
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
        console.error("Remove recipe from cookbook error:", error);
        sendError(
          res,
          500,
          "Failed to remove recipe from cookbook",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );
}
