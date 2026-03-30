import type { Express, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { logger, toError } from "../lib/logger";
import { ErrorCode } from "@shared/constants/error-codes";
import {
  pantryRateLimit,
  checkPremiumFeature,
  formatZodError,
  nullableNumericStringField,
  parsePositiveIntParam,
  parseQueryInt,
} from "./_helpers";

const pantryItemSchema = z.object({
  name: z.string().min(1).max(200),
  quantity: nullableNumericStringField,
  unit: z.string().max(50).optional().nullable(),
  category: z.string().max(50).optional().default("other"),
  expiresAt: z
    .string()
    .datetime()
    .optional()
    .nullable()
    .transform((v) => (v ? new Date(v) : null)),
});

const pantryItemUpdateSchema = pantryItemSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided for update",
  });

export function register(app: Express): void {
  // GET /api/pantry — List pantry items
  app.get(
    "/api/pantry",
    requireAuth,
    pantryRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "pantryTracking",
          "Pantry tracking",
        );
        if (!features) return;
        const limit = parseQueryInt(req.query.limit, {
          default: 200,
          max: 200,
        });
        const items = await storage.getPantryItems(req.userId, limit);
        res.json(items);
      } catch (error) {
        logger.error({ err: toError(error) }, "get pantry items error");
        sendError(
          res,
          500,
          "Failed to fetch pantry items",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // POST /api/pantry — Create pantry item
  app.post(
    "/api/pantry",
    requireAuth,
    pantryRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "pantryTracking",
          "Pantry tracking",
        );
        if (!features) return;

        const parsed = pantryItemSchema.safeParse(req.body);
        if (!parsed.success) {
          sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        const item = await storage.createPantryItem({
          userId: req.userId,
          name: parsed.data.name,
          quantity: parsed.data.quantity,
          unit: parsed.data.unit || null,
          category: parsed.data.category || "other",
          expiresAt: parsed.data.expiresAt || null,
        });
        res.status(201).json(item);
      } catch (error) {
        logger.error({ err: toError(error) }, "create pantry item error");
        sendError(
          res,
          500,
          "Failed to create pantry item",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // PUT /api/pantry/:id — Update pantry item
  app.put(
    "/api/pantry/:id",
    requireAuth,
    pantryRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "pantryTracking",
          "Pantry tracking",
        );
        if (!features) return;

        const id = parsePositiveIntParam(req.params.id);
        if (!id) {
          sendError(
            res,
            400,
            "Invalid pantry item ID",
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        const parsed = pantryItemUpdateSchema.safeParse(req.body);
        if (!parsed.success) {
          sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        const updated = await storage.updatePantryItem(
          id,
          req.userId,
          parsed.data,
        );
        if (!updated) {
          sendError(res, 404, "Pantry item not found", ErrorCode.NOT_FOUND);
          return;
        }
        res.json(updated);
      } catch (error) {
        logger.error({ err: toError(error) }, "update pantry item error");
        sendError(
          res,
          500,
          "Failed to update pantry item",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // DELETE /api/pantry/:id — Delete pantry item
  app.delete(
    "/api/pantry/:id",
    requireAuth,
    pantryRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "pantryTracking",
          "Pantry tracking",
        );
        if (!features) return;

        const id = parsePositiveIntParam(req.params.id);
        if (!id) {
          sendError(
            res,
            400,
            "Invalid pantry item ID",
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        const deleted = await storage.deletePantryItem(id, req.userId);
        if (!deleted) {
          sendError(res, 404, "Pantry item not found", ErrorCode.NOT_FOUND);
          return;
        }
        res.status(204).send();
      } catch (error) {
        logger.error({ err: toError(error) }, "delete pantry item error");
        sendError(
          res,
          500,
          "Failed to delete pantry item",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // GET /api/pantry/expiring — Get expiring items (within 3 days)
  app.get(
    "/api/pantry/expiring",
    requireAuth,
    pantryRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "pantryTracking",
          "Pantry tracking",
        );
        if (!features) return;

        const items = await storage.getExpiringPantryItems(req.userId, 3);
        res.json(items);
      } catch (error) {
        logger.error(
          { err: toError(error) },
          "get expiring pantry items error",
        );
        sendError(
          res,
          500,
          "Failed to fetch expiring items",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );
}
