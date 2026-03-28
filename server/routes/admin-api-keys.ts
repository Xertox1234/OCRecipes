import type { Express } from "express";
import { requireAuth } from "../middleware/auth";
import { storage } from "../storage";
import { sendError } from "../lib/api-errors";
import { z } from "zod";
import { API_TIERS } from "@shared/constants/api-tiers";
import { isAdmin } from "./_helpers";

const createKeySchema = z.object({
  name: z.string().min(1).max(100),
  tier: z.enum(API_TIERS as unknown as [string, ...string[]]).default("free"),
});

const updateTierSchema = z.object({
  tier: z.enum(API_TIERS as unknown as [string, ...string[]]),
});

export function register(app: Express): void {
  // Create a new API key
  app.post("/api/admin/api-keys", requireAuth, async (req, res) => {
    try {
      if (!req.userId || !isAdmin(req.userId)) {
        sendError(res, 403, "Admin access required", "UNAUTHORIZED");
        return;
      }

      const parsed = createKeySchema.safeParse(req.body);
      if (!parsed.success) {
        sendError(res, 400, "Invalid request body", "VALIDATION_ERROR");
        return;
      }

      const { name, tier } = parsed.data;
      const result = await storage.createApiKey(name, tier, req.userId);

      res.status(201).json({
        id: result.id,
        keyPrefix: result.keyPrefix,
        plaintextKey: result.plaintextKey,
        name,
        tier,
        message: "Store this key securely. It will not be shown again.",
      });
    } catch (err) {
      console.error("Admin create API key error:", err);
      sendError(res, 500, "Internal server error", "INTERNAL_ERROR");
    }
  });

  // List all API keys with usage stats
  app.get("/api/admin/api-keys", requireAuth, async (req, res) => {
    try {
      if (!req.userId || !isAdmin(req.userId)) {
        sendError(res, 403, "Admin access required", "UNAUTHORIZED");
        return;
      }

      const keys = await storage.listApiKeys();
      const keysWithUsage = await Promise.all(
        keys.map(async (key) => {
          const usage = await storage.getApiKeyUsageStats(key.id);
          return {
            id: key.id,
            keyPrefix: key.keyPrefix,
            name: key.name,
            tier: key.tier,
            status: key.status,
            createdAt: key.createdAt.toISOString(),
            revokedAt: key.revokedAt?.toISOString() ?? null,
            usage,
          };
        }),
      );

      res.json({ data: keysWithUsage });
    } catch (err) {
      console.error("Admin list API keys error:", err);
      sendError(res, 500, "Internal server error", "INTERNAL_ERROR");
    }
  });

  // Revoke an API key
  app.delete("/api/admin/api-keys/:id", requireAuth, async (req, res) => {
    try {
      if (!req.userId || !isAdmin(req.userId)) {
        sendError(res, 403, "Admin access required", "UNAUTHORIZED");
        return;
      }

      const id = parseInt(String(req.params.id), 10);
      if (Number.isNaN(id)) {
        sendError(res, 400, "Invalid key ID", "VALIDATION_ERROR");
        return;
      }

      const existing = await storage.getApiKey(id);
      if (!existing) {
        sendError(res, 404, "API key not found", "NOT_FOUND");
        return;
      }

      await storage.revokeApiKey(id);
      res.json({ message: "API key revoked" });
    } catch (err) {
      console.error("Admin revoke API key error:", err);
      sendError(res, 500, "Internal server error", "INTERNAL_ERROR");
    }
  });

  // Update an API key's tier
  app.patch("/api/admin/api-keys/:id", requireAuth, async (req, res) => {
    try {
      if (!req.userId || !isAdmin(req.userId)) {
        sendError(res, 403, "Admin access required", "UNAUTHORIZED");
        return;
      }

      const id = parseInt(String(req.params.id), 10);
      if (Number.isNaN(id)) {
        sendError(res, 400, "Invalid key ID", "VALIDATION_ERROR");
        return;
      }

      const parsed = updateTierSchema.safeParse(req.body);
      if (!parsed.success) {
        sendError(res, 400, "Invalid request body", "VALIDATION_ERROR");
        return;
      }

      const existing = await storage.getApiKey(id);
      if (!existing) {
        sendError(res, 404, "API key not found", "NOT_FOUND");
        return;
      }

      await storage.updateApiKeyTier(id, parsed.data.tier);
      res.json({ message: "API key tier updated", tier: parsed.data.tier });
    } catch (err) {
      console.error("Admin update API key tier error:", err);
      sendError(res, 500, "Internal server error", "INTERNAL_ERROR");
    }
  });
}
