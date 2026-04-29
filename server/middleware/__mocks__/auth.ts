// This mock must be kept in sync with server/middleware/auth.ts exports.
// If new exports are added to the real module, add corresponding mocks here.
import { vi } from "vitest";
import type { Request, Response, NextFunction } from "express";

export const requireAuth = vi.fn(
  (req: Request, _res: Response, next: NextFunction) => {
    req.userId = "1";
    next();
  },
);

export const generateToken = vi.fn().mockReturnValue("mock-jwt-token");

export const invalidateTokenVersionCache = vi.fn();
