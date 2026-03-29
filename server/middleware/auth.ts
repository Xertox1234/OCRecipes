import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { isAccessTokenPayload } from "../lib/jwt-types";
import { storage } from "../storage";
import { sendError } from "../lib/api-errors";

// Extend Express Request type.
// userId is declared as non-optional because all routes that access it
// sit behind requireAuth middleware which guarantees it is set.
// Non-authenticated routes (login, register) do not read req.userId.
declare global {
  namespace Express {
    interface Request {
      userId: string;
    }
  }
}

/**
 * Semantic alias for routes behind requireAuth middleware.
 * Structurally identical to Request, but signals intent in handler signatures.
 */
export type AuthenticatedRequest = Request;

// Validate on module load - fail fast
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required");
}
// TypeScript now knows JWT_SECRET is defined after the check above
const jwtSecret: string = JWT_SECRET;

// In-memory cache for tokenVersion to avoid DB lookup on every request.
// Short TTL (60s) balances performance with revocation responsiveness.
// Cache is invalidated on logout via invalidateTokenVersionCache().
// WARNING: This cache is process-local. In a multi-instance deployment, replace with Redis or a shared cache.
const tokenVersionCache = new Map<
  string,
  { version: number; expiresAt: number }
>();
const TOKEN_VERSION_CACHE_TTL_MS = 60_000; // 60 seconds
const MAX_CACHE_SIZE = 10_000;

function getCachedTokenVersion(userId: string): number | undefined {
  const entry = tokenVersionCache.get(userId);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    tokenVersionCache.delete(userId);
    return undefined;
  }
  return entry.version;
}

function setCachedTokenVersion(userId: string, version: number): void {
  // Evict oldest entry (first key in iteration order) when cache is full
  if (tokenVersionCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = tokenVersionCache.keys().next().value;
    if (oldestKey !== undefined) {
      tokenVersionCache.delete(oldestKey);
    }
  }
  tokenVersionCache.set(userId, {
    version,
    expiresAt: Date.now() + TOKEN_VERSION_CACHE_TTL_MS,
  });
}

// Periodic sweep to remove expired entries (every 5 minutes).
// The cast to NodeJS.Timeout is needed because the shared tsconfig
// resolves setInterval to the DOM overload (returns number).
const sweepInterval = setInterval(
  () => {
    const now = Date.now();
    for (const [key, entry] of tokenVersionCache) {
      if (now > entry.expiresAt) {
        tokenVersionCache.delete(key);
      }
    }
  },
  5 * 60 * 1000,
) as unknown as NodeJS.Timeout;
sweepInterval.unref();

/** Call on logout to immediately invalidate cached tokenVersion */
export function invalidateTokenVersionCache(userId: string): void {
  tokenVersionCache.delete(userId);
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    sendError(res, 401, "No token provided", "NO_TOKEN");
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, jwtSecret);

    if (!isAccessTokenPayload(payload)) {
      sendError(res, 401, "Invalid token payload", "TOKEN_INVALID");
      return;
    }

    // Check tokenVersion — use cache to avoid DB hit on every request
    const cachedVersion = getCachedTokenVersion(payload.sub);
    if (cachedVersion !== undefined) {
      if (payload.tokenVersion !== cachedVersion) {
        sendError(res, 401, "Token has been revoked", "TOKEN_REVOKED");
        return;
      }
    } else {
      // Cache miss — query DB
      const user = await storage.getUser(payload.sub);
      if (!user) {
        sendError(res, 401, "User not found", "TOKEN_INVALID");
        return;
      }

      setCachedTokenVersion(payload.sub, user.tokenVersion);

      if (payload.tokenVersion !== user.tokenVersion) {
        sendError(res, 401, "Token has been revoked", "TOKEN_REVOKED");
        return;
      }
    }

    req.userId = payload.sub;
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      sendError(res, 401, "Token expired", "TOKEN_EXPIRED");
      return;
    }
    sendError(res, 401, "Invalid token", "TOKEN_INVALID");
  }
}

export function generateToken(userId: string, tokenVersion: number): string {
  return jwt.sign({ sub: userId, tokenVersion }, jwtSecret, {
    expiresIn: "7d",
  });
}
