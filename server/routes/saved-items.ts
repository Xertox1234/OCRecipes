import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { requireAuth } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { createSavedItemSchema } from "@shared/schemas/saved-items";
import { formatZodError, parsePositiveIntParam, parseQueryInt } from "./_helpers";

export function register(app: Express): void {
  app.get(
    "/api/saved-items",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const limit = parseQueryInt(req.query.limit, { default: 100, max: 100 });
        const items = await storage.getSavedItems(req.userId!, limit);
        res.json(items);
      } catch (error) {
        console.error("Get saved items error:", error);
        sendError(res, 500, "Failed to get saved items");
      }
    },
  );

  app.get(
    "/api/saved-items/count",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const count = await storage.getSavedItemCount(req.userId!);
        res.json({ count });
      } catch (error) {
        console.error("Get saved items count error:", error);
        sendError(res, 500, "Failed to get saved items count");
      }
    },
  );

  app.post(
    "/api/saved-items",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const parsed = createSavedItemSchema.safeParse(req.body);
        if (!parsed.success) {
          sendError(res, 400, formatZodError(parsed.error));
          return;
        }

        const item = await storage.createSavedItem(req.userId!, parsed.data);
        if (!item) {
          sendError(res, 403, "Saved item limit reached", "LIMIT_REACHED");
          return;
        }

        res.status(201).json(item);
      } catch (error) {
        console.error("Create saved item error:", error);
        sendError(res, 500, "Failed to create saved item");
      }
    },
  );

  app.delete(
    "/api/saved-items/:id",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const id = parsePositiveIntParam(req.params.id);
        if (!id) {
          sendError(res, 400, "Invalid item ID");
          return;
        }

        // IDOR protection built into deleteSavedItem
        const deleted = await storage.deleteSavedItem(id, req.userId!);
        if (!deleted) {
          sendError(res, 404, "Item not found");
          return;
        }

        res.status(204).send();
      } catch (error) {
        console.error("Delete saved item error:", error);
        sendError(res, 500, "Failed to delete saved item");
      }
    },
  );
}
