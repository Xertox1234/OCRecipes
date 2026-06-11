import type { Request, Response, NextFunction } from "express";
import { vi } from "vitest";

// Neuter only the rateLimit middleware factory. ipKeyGenerator is a pure
// helper (IPv6 /56 subnet normalization) with no middleware side effects —
// re-export the real one so unit tests exercise actual normalization
// instead of a hand-written stand-in.
const actual =
  await vi.importActual<typeof import("express-rate-limit")>(
    "express-rate-limit",
  );

const passthrough = () => (_req: Request, _res: Response, next: NextFunction) =>
  next();

export const rateLimit = passthrough;
export const ipKeyGenerator = actual.ipKeyGenerator;
export default passthrough;
