import type { Express, Response } from "express";
import { storage } from "../storage";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { createSavedItemSchema } from "@shared/schemas/saved-items";
import {
  formatZodError,
  parsePositiveIntParam,
  parseQueryInt,
  crudRateLimit,
} from "./_helpers";

export function register(app: Express): void {
  app.get(
    "/api/saved-items",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const limit = parseQueryInt(req.query.limit, {
          default: 100,
          max: 100,
        });
        const items = await storage.getSavedItems(req.userId, limit);
        res.json(items);
      } catch (error) {
        console.error("Get saved items error:", error);
        sendError(
          res,
          500,
          "Failed to get saved items",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  app.get(
    "/api/saved-items/count",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const count = await storage.getSavedItemCount(req.userId);
        res.json({ count });
      } catch (error) {
        console.error("Get saved items count error:", error);
        sendError(
          res,
          500,
          "Failed to get saved items count",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  app.post(
    "/api/saved-items",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const parsed = createSavedItemSchema.safeParse(req.body);
        if (!parsed.success) {
          sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        const item = await storage.createSavedItem(req.userId, parsed.data);
        if (!item) {
          sendError(
            res,
            403,
            "Saved item limit reached",
            ErrorCode.LIMIT_REACHED,
          );
          return;
        }

        res.status(201).json(item);
      } catch (error) {
        console.error("Create saved item error:", error);
        sendError(
          res,
          500,
          "Failed to create saved item",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  app.delete(
    "/api/saved-items/:id",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const id = parsePositiveIntParam(req.params.id);
        if (!id) {
          sendError(res, 400, "Invalid item ID", ErrorCode.VALIDATION_ERROR);
          return;
        }

        // IDOR protection built into deleteSavedItem
        const deleted = await storage.deleteSavedItem(id, req.userId);
        if (!deleted) {
          sendError(res, 404, "Item not found", ErrorCode.NOT_FOUND);
          return;
        }

        res.status(204).send();
      } catch (error) {
        console.error("Delete saved item error:", error);
        sendError(
          res,
          500,
          "Failed to delete saved item",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );
}
