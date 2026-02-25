import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { requireAuth } from "../middleware/auth";
import { createSavedItemSchema } from "@shared/schemas/saved-items";
import { formatZodError, parsePositiveIntParam } from "./_helpers";

export function register(app: Express): void {
  app.get(
    "/api/saved-items",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const items = await storage.getSavedItems(req.userId!);
        res.json(items);
      } catch (error) {
        console.error("Get saved items error:", error);
        res.status(500).json({ error: "Failed to get saved items" });
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
        res.status(500).json({ error: "Failed to get saved items count" });
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
          res.status(400).json({ error: formatZodError(parsed.error) });
          return;
        }

        const item = await storage.createSavedItem(req.userId!, parsed.data);
        if (!item) {
          res.status(403).json({ error: "LIMIT_REACHED" });
          return;
        }

        res.status(201).json(item);
      } catch (error) {
        console.error("Create saved item error:", error);
        res.status(500).json({ error: "Failed to create saved item" });
      }
    },
  );

  app.delete(
    "/api/saved-items/:id",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const id = parsePositiveIntParam(req.params.id as string);
        if (!id) {
          res.status(400).json({ error: "Invalid item ID" });
          return;
        }

        // IDOR protection built into deleteSavedItem
        const deleted = await storage.deleteSavedItem(id, req.userId!);
        if (!deleted) {
          res.status(404).json({ error: "Item not found" });
          return;
        }

        res.status(204).send();
      } catch (error) {
        console.error("Delete saved item error:", error);
        res.status(500).json({ error: "Failed to delete saved item" });
      }
    },
  );
}
