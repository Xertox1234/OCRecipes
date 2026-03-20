import { vi } from "vitest";
import type { Request, Response, NextFunction } from "express";

export const apiRateLimiter = (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  res.setHeader("X-RateLimit-Limit", 500);
  res.setHeader("X-RateLimit-Remaining", 499);
  res.setHeader("X-RateLimit-Reset", new Date().toISOString());
  next();
};

export const clearUsageCache = vi.fn();
