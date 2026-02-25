import type { Express, Request, Response } from "express";
import { requireAuth } from "../middleware/auth";
import { storage } from "../storage";
import { analyzeMenuPhoto } from "../services/menu-analysis";
import {
  checkPremiumFeature,
  ipKeyGenerator,
  parsePositiveIntParam,
} from "./_helpers";
import { rateLimit } from "express-rate-limit";
import multer from "multer";

const menuRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 5, // Menu analysis is expensive
  message: { error: "Too many menu scan requests. Please wait." },
  keyGenerator: (req) => req.userId || ipKeyGenerator(req),
  standardHeaders: true,
  legacyHeaders: false,
});

const menuUpload = multer({
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB for menu photos (larger than food photos)
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    const allowedMimes = ["image/jpeg", "image/png", "image/webp"];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only JPEG, PNG, and WebP allowed."));
    }
  },
});

export function register(app: Express): void {
  // POST /api/menu/scan
  app.post(
    "/api/menu/scan",
    requireAuth,
    menuRateLimit,
    menuUpload.single("photo"),
    async (req: Request, res: Response) => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "menuScanner",
          "Menu Scanner",
        );
        if (!features) return;

        if (!req.file) {
          return res.status(400).json({ error: "No photo provided" });
        }

        const imageBase64 = req.file.buffer.toString("base64");
        const result = await analyzeMenuPhoto(imageBase64, req.userId!);

        // Persist the scan result
        const saved = await storage.createMenuScan({
          userId: req.userId!,
          restaurantName: result.restaurantName ?? null,
          cuisine: result.cuisine ?? null,
          menuItems: result.menuItems ?? [],
        });

        res.json({ ...result, id: saved.id });
      } catch (error) {
        console.error("Menu scan error:", error);
        res.status(500).json({ error: "Failed to analyze menu" });
      }
    },
  );

  // GET /api/menu/history
  app.get(
    "/api/menu/history",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const features = await checkPremiumFeature(
          req,
          res,
          "menuScanner",
          "Menu Scanner",
        );
        if (!features) return;

        const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
        const scans = await storage.getMenuScans(req.userId!, limit);
        res.json(scans);
      } catch (error) {
        console.error("Get menu history error:", error);
        res.status(500).json({ error: "Failed to get menu history" });
      }
    },
  );

  // DELETE /api/menu/scans/:id
  app.delete(
    "/api/menu/scans/:id",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const id = parsePositiveIntParam(req.params.id as string);
        if (!id) return res.status(400).json({ error: "Invalid scan ID" });

        const deleted = await storage.deleteMenuScan(id, req.userId!);
        if (!deleted)
          return res.status(404).json({ error: "Menu scan not found" });
        res.json({ success: true });
      } catch (error) {
        console.error("Delete menu scan error:", error);
        res.status(500).json({ error: "Failed to delete menu scan" });
      }
    },
  );
}
