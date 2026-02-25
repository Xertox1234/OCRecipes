import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { isAccessTokenPayload } from "@shared/types/auth";
import { storage } from "../storage";

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

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
const tokenVersionCache = new Map<string, { version: number; expiresAt: number }>();
const TOKEN_VERSION_CACHE_TTL_MS = 60_000; // 60 seconds

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
  tokenVersionCache.set(userId, {
    version,
    expiresAt: Date.now() + TOKEN_VERSION_CACHE_TTL_MS,
  });
}

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
    res.status(401).json({ error: "No token provided", code: "NO_TOKEN" });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, jwtSecret);

    if (!isAccessTokenPayload(payload)) {
      res
        .status(401)
        .json({ error: "Invalid token payload", code: "TOKEN_INVALID" });
      return;
    }

    // Check tokenVersion — use cache to avoid DB hit on every request
    const cachedVersion = getCachedTokenVersion(payload.sub);
    if (cachedVersion !== undefined) {
      if (payload.tokenVersion !== cachedVersion) {
        res
          .status(401)
          .json({ error: "Token has been revoked", code: "TOKEN_REVOKED" });
        return;
      }
    } else {
      // Cache miss — query DB
      const user = await storage.getUser(payload.sub);
      if (!user) {
        res
          .status(401)
          .json({ error: "User not found", code: "TOKEN_INVALID" });
        return;
      }

      setCachedTokenVersion(payload.sub, user.tokenVersion);

      if (payload.tokenVersion !== user.tokenVersion) {
        res
          .status(401)
          .json({ error: "Token has been revoked", code: "TOKEN_REVOKED" });
        return;
      }
    }

    req.userId = payload.sub;
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: "Token expired", code: "TOKEN_EXPIRED" });
      return;
    }
    res.status(401).json({ error: "Invalid token", code: "TOKEN_INVALID" });
  }
}

export function generateToken(
  userId: string,
  tokenVersion: number,
): string {
  return jwt.sign({ sub: userId, tokenVersion }, jwtSecret, {
    expiresIn: "7d",
  });
}
