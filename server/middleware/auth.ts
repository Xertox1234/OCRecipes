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

    // Verify tokenVersion against database
    const user = await storage.getUser(payload.sub);
    if (!user) {
      res
        .status(401)
        .json({ error: "User not found", code: "TOKEN_INVALID" });
      return;
    }

    if (payload.tokenVersion !== user.tokenVersion) {
      res
        .status(401)
        .json({ error: "Token has been revoked", code: "TOKEN_REVOKED" });
      return;
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
