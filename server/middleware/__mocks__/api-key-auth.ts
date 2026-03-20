import { vi } from "vitest";
import type { Request, Response, NextFunction } from "express";

export const requireApiKey = (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  req.apiKeyId = 1;
  req.apiKeyTier = "free";
  next();
};

export const invalidateApiKeyCache = vi.fn();
export const clearApiKeyCache = vi.fn();
