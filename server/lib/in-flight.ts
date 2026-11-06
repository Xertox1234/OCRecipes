import type { NextFunction, Request, Response } from "express";
import { ErrorCode } from "@shared/constants/error-codes";
import { sendError } from "./api-errors";

/**
 * Per-key "one at a time" claims for a write that must not run twice
 * concurrently — the double tap that sends two identical requests before the
 * first has answered. In-process only, like the analysis/cook sessions these
 * routes already keep in memory (single server instance).
 *
 * It refuses an OVERLAPPING duplicate; it is not an idempotency record (a
 * request sent after the first has finished runs normally).
 */
export interface InFlightGuard {
  /** true if the key was free and is now held by the caller. */
  claim(key: string): boolean;
  release(key: string): void;
}

export function createInFlightGuard(): InFlightGuard {
  const held = new Set<string>();
  return {
    claim(key) {
      if (held.has(key)) return false;
      held.add(key);
      return true;
    },
    release(key) {
      held.delete(key);
    },
  };
}

/**
 * Express middleware: answers 409 CONFLICT to a request whose key is already
 * in flight, without running the handler. The key is released when the
 * response closes (sent, errored or the client went away). Mount it after
 * requireAuth and choose a key that names the write — the user plus the
 * session or the payload — so two different writes never block each other.
 */
export function rejectOverlapping(keyOf: (req: Request) => string) {
  const guard = createInFlightGuard();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = keyOf(req);
    if (!guard.claim(key)) {
      sendError(res, 409, "This is already being saved", ErrorCode.CONFLICT);
      return;
    }
    res.on("close", () => guard.release(key));
    next();
  };
}
