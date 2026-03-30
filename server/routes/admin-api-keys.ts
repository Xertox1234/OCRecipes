import type { Express, Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { storage } from "../storage";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { logger, toError } from "../lib/logger";
import { z } from "zod";
import { API_TIERS } from "@shared/constants/api-tiers";
import { isAdmin, crudRateLimit } from "./_helpers";

const createKeySchema = z.object({
  name: z.string().min(1).max(100),
  tier: z.enum(API_TIERS as unknown as [string, ...string[]]).default("free"),
});

const updateTierSchema = z.object({
  tier: z.enum(API_TIERS as unknown as [string, ...string[]]),
});

export function register(app: Express): void {
  // Create a new API key
  app.post(
    "/api/admin/api-keys",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        if (!isAdmin(req.userId)) {
          sendError(res, 403, "Admin access required", ErrorCode.UNAUTHORIZED);
          return;
        }

        const parsed = createKeySchema.safeParse(req.body);
        if (!parsed.success) {
          sendError(
            res,
            400,
            "Invalid request body",
            ErrorCode.VALIDATION_ERROR,
          );
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
        logger.error({ err: toError(err) }, "admin create API key error");
        sendError(res, 500, "Internal server error", ErrorCode.INTERNAL_ERROR);
      }
    },
  );

  // List all API keys with usage stats
  app.get(
    "/api/admin/api-keys",
    requireAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        if (!isAdmin(req.userId)) {
          sendError(res, 403, "Admin access required", ErrorCode.UNAUTHORIZED);
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
        logger.error({ err: toError(err) }, "admin list API keys error");
        sendError(res, 500, "Internal server error", ErrorCode.INTERNAL_ERROR);
      }
    },
  );

  // Revoke an API key
  app.delete(
    "/api/admin/api-keys/:id",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        if (!isAdmin(req.userId)) {
          sendError(res, 403, "Admin access required", ErrorCode.UNAUTHORIZED);
          return;
        }

        const id = parseInt(String(req.params.id), 10);
        if (Number.isNaN(id)) {
          sendError(res, 400, "Invalid key ID", ErrorCode.VALIDATION_ERROR);
          return;
        }

        const existing = await storage.getApiKey(id);
        if (!existing) {
          sendError(res, 404, "API key not found", ErrorCode.NOT_FOUND);
          return;
        }

        await storage.revokeApiKey(id);
        res.json({ message: "API key revoked" });
      } catch (err) {
        logger.error({ err: toError(err) }, "admin revoke API key error");
        sendError(res, 500, "Internal server error", ErrorCode.INTERNAL_ERROR);
      }
    },
  );

  // Update an API key's tier
  app.patch(
    "/api/admin/api-keys/:id",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        if (!isAdmin(req.userId)) {
          sendError(res, 403, "Admin access required", ErrorCode.UNAUTHORIZED);
          return;
        }

        const id = parseInt(String(req.params.id), 10);
        if (Number.isNaN(id)) {
          sendError(res, 400, "Invalid key ID", ErrorCode.VALIDATION_ERROR);
          return;
        }

        const parsed = updateTierSchema.safeParse(req.body);
        if (!parsed.success) {
          sendError(
            res,
            400,
            "Invalid request body",
            ErrorCode.VALIDATION_ERROR,
          );
          return;
        }

        const existing = await storage.getApiKey(id);
        if (!existing) {
          sendError(res, 404, "API key not found", ErrorCode.NOT_FOUND);
          return;
        }

        await storage.updateApiKeyTier(id, parsed.data.tier);
        res.json({ message: "API key tier updated", tier: parsed.data.tier });
      } catch (err) {
        logger.error({ err: toError(err) }, "admin update API key tier error");
        sendError(res, 500, "Internal server error", ErrorCode.INTERNAL_ERROR);
      }
    },
  );
}
