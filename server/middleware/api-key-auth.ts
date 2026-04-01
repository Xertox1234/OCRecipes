import { Request, Response, NextFunction } from "express";
import bcrypt from "bcrypt";
import { createHash } from "crypto";
import { storage } from "../storage";
import { sendError } from "../lib/api-errors";
import { logger, toError } from "../lib/logger";

// Extend Express Request type for API key auth
declare global {
  namespace Express {
    interface Request {
      apiKeyId?: number;
      apiKeyTier?: string;
    }
  }
}

const KEY_PREFIX_LENGTH = 16;

/** SHA-256 hash of the raw key — used as cache key to avoid storing plaintext in memory */
function cacheKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

// In-memory cache for validated API keys to avoid DB + bcrypt on every request.
// Short TTL (60s) balances performance with revocation responsiveness.
// Keys are stored as SHA-256 hashes to prevent plaintext exposure in memory dumps.
const apiKeyCache = new Map<
  string,
  { id: number; tier: string; status: string; expiresAt: number }
>();
const API_KEY_CACHE_TTL_MS = 60_000;
const MAX_CACHED_KEYS = 10_000;

function getCachedApiKey(rawKey: string) {
  const hash = cacheKey(rawKey);
  const entry = apiKeyCache.get(hash);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    apiKeyCache.delete(hash);
    return undefined;
  }
  return entry;
}

function setCachedApiKey(
  rawKey: string,
  data: { id: number; tier: string; status: string },
): void {
  if (apiKeyCache.size >= MAX_CACHED_KEYS) {
    const oldestKey = apiKeyCache.keys().next().value;
    if (oldestKey !== undefined) {
      apiKeyCache.delete(oldestKey);
    }
  }
  apiKeyCache.set(cacheKey(rawKey), {
    ...data,
    expiresAt: Date.now() + API_KEY_CACHE_TTL_MS,
  });
}

/** Immediately remove a cached API key (call on revocation) */
export function invalidateApiKeyCache(rawKey: string): void {
  apiKeyCache.delete(cacheKey(rawKey));
}

/** Clear all cached keys (for testing) */
export function clearApiKeyCache(): void {
  apiKeyCache.clear();
}

// Periodic sweep to remove expired entries (every 5 minutes)
const sweepInterval = setInterval(
  () => {
    const now = Date.now();
    for (const [key, entry] of apiKeyCache) {
      if (now > entry.expiresAt) {
        apiKeyCache.delete(key);
      }
    }
  },
  5 * 60 * 1000,
) as unknown as NodeJS.Timeout;
sweepInterval.unref();

export async function requireApiKey(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // Reject keys passed as query params (security: prevents URL logging)
  if (req.query.api_key || req.query.apiKey) {
    sendError(
      res,
      400,
      "API key must be sent in X-API-Key header, not as a query parameter",
      "API_KEY_INVALID",
    );
    return;
  }

  const rawKey = req.headers["x-api-key"];
  if (!rawKey || typeof rawKey !== "string") {
    sendError(res, 401, "API key required", "API_KEY_INVALID");
    return;
  }

  // Check cache first
  const cached = getCachedApiKey(rawKey);
  if (cached) {
    if (cached.status === "revoked") {
      sendError(res, 401, "API key has been revoked", "API_KEY_REVOKED");
      return;
    }
    req.apiKeyId = cached.id;
    req.apiKeyTier = cached.tier;
    next();
    return;
  }

  // Cache miss — look up by prefix, verify with bcrypt
  const prefix = rawKey.substring(0, KEY_PREFIX_LENGTH);
  try {
    const keyRow = await storage.getApiKeyByPrefix(prefix);
    if (!keyRow) {
      sendError(res, 401, "Invalid API key", "API_KEY_INVALID");
      return;
    }

    const valid = await bcrypt.compare(rawKey, keyRow.keyHash);
    if (!valid) {
      sendError(res, 401, "Invalid API key", "API_KEY_INVALID");
      return;
    }

    // Cache the validated key
    setCachedApiKey(rawKey, {
      id: keyRow.id,
      tier: keyRow.tier,
      status: keyRow.status,
    });

    if (keyRow.status === "revoked") {
      sendError(res, 401, "API key has been revoked", "API_KEY_REVOKED");
      return;
    }

    req.apiKeyId = keyRow.id;
    req.apiKeyTier = keyRow.tier;
    next();
  } catch (err) {
    logger.error({ err: toError(err) }, "API key auth error");
    sendError(res, 500, "Internal server error", "INTERNAL_ERROR");
  }
}
