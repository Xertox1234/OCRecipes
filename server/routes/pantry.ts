import type { Express, Request, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAuth } from "../middleware/auth";
import {
  pantryRateLimit,
  checkPremiumFeature,
  formatZodError,
} from "./_helpers";

const pantryItemSchema = z.object({
  name: z.string().min(1).max(200),
  quantity: z
    .union([z.string(), z.number()])
    .optional()
    .nullable()
    .transform((v) => v?.toString() ?? null),
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
    async (req: Request, res: Response): Promise<void> => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "pantryTracking",
          "Pantry tracking",
        );
        if (!features) return;
        const limit = Math.min(parseInt(req.query.limit as string) || 200, 200);
        const items = await storage.getPantryItems(req.userId!, limit);
        res.json(items);
      } catch (error) {
        console.error("Get pantry items error:", error);
        res.status(500).json({ error: "Failed to fetch pantry items" });
      }
    },
  );

  // POST /api/pantry — Create pantry item
  app.post(
    "/api/pantry",
    requireAuth,
    pantryRateLimit,
    async (req: Request, res: Response): Promise<void> => {
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
          res.status(400).json({ error: formatZodError(parsed.error) });
          return;
        }

        const item = await storage.createPantryItem({
          userId: req.userId!,
          name: parsed.data.name,
          quantity: parsed.data.quantity,
          unit: parsed.data.unit || null,
          category: parsed.data.category || "other",
          expiresAt: parsed.data.expiresAt || null,
        });
        res.status(201).json(item);
      } catch (error) {
        console.error("Create pantry item error:", error);
        res.status(500).json({ error: "Failed to create pantry item" });
      }
    },
  );

  // PUT /api/pantry/:id — Update pantry item
  app.put(
    "/api/pantry/:id",
    requireAuth,
    pantryRateLimit,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "pantryTracking",
          "Pantry tracking",
        );
        if (!features) return;

        const id = parseInt(req.params.id as string, 10);
        if (isNaN(id) || id <= 0) {
          res.status(400).json({ error: "Invalid pantry item ID" });
          return;
        }

        const parsed = pantryItemUpdateSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: formatZodError(parsed.error) });
          return;
        }

        const updated = await storage.updatePantryItem(
          id,
          req.userId!,
          parsed.data,
        );
        if (!updated) {
          res.status(404).json({ error: "Pantry item not found" });
          return;
        }
        res.json(updated);
      } catch (error) {
        console.error("Update pantry item error:", error);
        res.status(500).json({ error: "Failed to update pantry item" });
      }
    },
  );

  // DELETE /api/pantry/:id — Delete pantry item
  app.delete(
    "/api/pantry/:id",
    requireAuth,
    pantryRateLimit,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "pantryTracking",
          "Pantry tracking",
        );
        if (!features) return;

        const id = parseInt(req.params.id as string, 10);
        if (isNaN(id) || id <= 0) {
          res.status(400).json({ error: "Invalid pantry item ID" });
          return;
        }

        const deleted = await storage.deletePantryItem(id, req.userId!);
        if (!deleted) {
          res.status(404).json({ error: "Pantry item not found" });
          return;
        }
        res.status(204).send();
      } catch (error) {
        console.error("Delete pantry item error:", error);
        res.status(500).json({ error: "Failed to delete pantry item" });
      }
    },
  );

  // GET /api/pantry/expiring — Get expiring items (within 3 days)
  app.get(
    "/api/pantry/expiring",
    requireAuth,
    pantryRateLimit,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "pantryTracking",
          "Pantry tracking",
        );
        if (!features) return;

        const items = await storage.getExpiringPantryItems(req.userId!, 3);
        res.json(items);
      } catch (error) {
        console.error("Get expiring pantry items error:", error);
        res.status(500).json({ error: "Failed to fetch expiring items" });
      }
    },
  );
}
