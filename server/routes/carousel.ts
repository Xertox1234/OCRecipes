import type { Express } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { buildCarousel } from "../services/carousel-builder";
import { sendError } from "../lib/api-errors";
import { crudRateLimit } from "./_rate-limiters";
import { handleRouteError, formatZodError } from "./_helpers";

const dismissSchema = z.object({
  recipeId: z.number().int().positive(),
});

export function register(app: Express): void {
  // ── GET /api/carousel ────────────────────────────────────
  app.get(
    "/api/carousel",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res) => {
      try {
        const userProfile = (await storage.getUserProfile(req.userId!)) ?? null;

        const rawHour = req.headers["x-user-hour"];
        let userHour: number | undefined;
        if (typeof rawHour === "string" && rawHour !== "") {
          const parsed = Number(rawHour);
          if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 23) {
            userHour = parsed;
          }
        }

        const cards = await buildCarousel(req.userId!, userProfile, userHour);

        res.json({ cards });
      } catch (error) {
        handleRouteError(res, error, "carousel:get");
      }
    },
  );

  // ── POST /api/carousel/dismiss ───────────────────────────
  app.post(
    "/api/carousel/dismiss",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res) => {
      try {
        const parsed = dismissSchema.safeParse(req.body);
        if (!parsed.success) {
          sendError(res, 400, formatZodError(parsed.error));
          return;
        }

        await storage.dismissRecipe(req.userId!, parsed.data.recipeId);

        res.status(204).send();
      } catch (error) {
        handleRouteError(res, error, "carousel:dismiss");
      }
    },
  );
}
