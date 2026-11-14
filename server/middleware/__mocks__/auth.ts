// This mock must be kept in sync with server/middleware/auth.ts exports.
// If new exports are added to the real module, add corresponding mocks here.
import { vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { installAiSharingLookup } from "../../lib/ai-sharing-gate";

// The mock signs every request in as user "1"; that user allows AI sharing,
// so route tests reach the feature under test. The gate's refusals are
// covered by lib/__tests__/ai-sharing-gate.test.ts and
// routes/__tests__/ai-sharing-enforcement.test.ts, which install their own.
installAiSharingLookup(() => Promise.resolve(true));

export const requireAuth = vi.fn(
  (req: Request, _res: Response, next: NextFunction) => {
    req.userId = "1";
    next();
  },
);

export const generateToken = vi.fn().mockReturnValue("mock-jwt-token");

export const invalidateTokenVersionCache = vi.fn();
