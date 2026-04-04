import type { Express, Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { storage } from "../storage";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { analyzeMenuPhoto } from "../services/menu-analysis";
import {
  checkPremiumFeature,
  checkAiConfigured,
  handleRouteError,
  parsePositiveIntParam,
  parseQueryInt,
} from "./_helpers";
import { menuRateLimit, crudRateLimit } from "./_rate-limiters";
import { createImageUpload } from "./_upload";
import { detectImageMimeType } from "../lib/image-mime";

const menuUpload = createImageUpload(5 * 1024 * 1024);

export function register(app: Express): void {
  // POST /api/menu/scan
  app.post(
    "/api/menu/scan",
    requireAuth,
    menuRateLimit,
    menuUpload.single("photo"),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "menuScanner",
          "Menu Scanner",
        );
        if (!features) return;

        if (!req.file) {
          return sendError(
            res,
            400,
            "No photo provided",
            ErrorCode.VALIDATION_ERROR,
          );
        }

        // Validate actual file content via magic bytes (do not trust client header)
        if (!detectImageMimeType(req.file.buffer)) {
          return sendError(
            res,
            400,
            "Invalid image content. Only JPEG, PNG, and WebP allowed.",
            ErrorCode.VALIDATION_ERROR,
          );
        }

        if (!checkAiConfigured(res)) return;

        const imageBase64 = req.file.buffer.toString("base64");
        const result = await analyzeMenuPhoto(imageBase64, req.userId);

        // Persist the scan result
        const saved = await storage.createMenuScan({
          userId: req.userId,
          restaurantName: result.restaurantName ?? null,
          cuisine: result.cuisine ?? null,
          menuItems: result.menuItems ?? [],
        });

        res.json({ ...result, id: saved.id });
      } catch (error) {
        handleRouteError(res, error, "analyze menu");
      }
    },
  );

  // GET /api/menu/history
  app.get(
    "/api/menu/history",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "menuScanner",
          "Menu Scanner",
        );
        if (!features) return;

        const limit = parseQueryInt(req.query.limit, { default: 20, max: 50 });
        const scans = await storage.getMenuScans(req.userId, limit);
        res.json(scans);
      } catch (error) {
        handleRouteError(res, error, "get menu history");
      }
    },
  );

  // DELETE /api/menu/scans/:id
  app.delete(
    "/api/menu/scans/:id",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const id = parsePositiveIntParam(req.params.id);
        if (!id)
          return sendError(
            res,
            400,
            "Invalid scan ID",
            ErrorCode.VALIDATION_ERROR,
          );

        const deleted = await storage.deleteMenuScan(id, req.userId);
        if (!deleted)
          return sendError(
            res,
            404,
            "Menu scan not found",
            ErrorCode.NOT_FOUND,
          );
        res.status(204).send();
      } catch (error) {
        handleRouteError(res, error, "delete menu scan");
      }
    },
  );
}
