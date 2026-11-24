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
 * Express middleware: answers 409 REQUEST_IN_FLIGHT to a request whose key is already
 * in flight, without running the handler. The key is released when the
 * response closes (sent, errored or the client went away). Mount it after
 * requireAuth and choose a key that names the write — the user plus the
 * session or the payload — so two different writes never block each other.
 */
export function rejectOverlapping(
  keyOf: (req: Request) => string,
  message = "This is already being saved",
) {
  const guard = createInFlightGuard();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = keyOf(req);
    if (!guard.claim(key)) {
      sendError(res, 409, message, ErrorCode.REQUEST_IN_FLIGHT);
      return;
    }
    res.on("close", () => guard.release(key));
    next();
  };
}

/**
 * One turn at a time in a chat conversation: a typed message and a photo are
 * both turns, so both routes mount this one instance and share its claims. A
 * second turn sent while the first is still being answered is refused before
 * anything is stored. The app already holds its send controls while a turn
 * runs; this covers a second device or another client. Releasing on close
 * means a turn the user stopped frees the conversation at once; it also means
 * work that carries on after a disconnect (a recipe turn still saving) is not
 * covered.
 */
export const rejectOverlappingChatTurn = rejectOverlapping(
  (req) => `${req.userId}:${Number(req.params.id)}`,
  "The Coach is still answering. Please wait for the reply.",
);
