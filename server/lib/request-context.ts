import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";

export interface RequestContext {
  requestId: string;
  userId: string | null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const als = new AsyncLocalStorage<RequestContext>();

/** Get the current request context, or undefined outside a request. */
export function getRequestContext(): RequestContext | undefined {
  return als.getStore();
}

/** Update the userId in the current request context (called by auth middleware). */
export function setRequestUserId(userId: string): void {
  const ctx = als.getStore();
  if (ctx) {
    ctx.userId = userId;
  }
}

/**
 * Express middleware that creates an AsyncLocalStorage context per request.
 * Must be registered after pino-http (so req.id is available) and before routes.
 */
export function requestContextMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.headers["x-request-id"] as string | undefined;
  const requestId =
    incoming && UUID_RE.test(incoming) ? incoming : crypto.randomUUID();

  // Set request ID on response header for client-side correlation
  res.setHeader("X-Request-Id", requestId);

  als.run({ requestId, userId: null }, () => {
    next();
  });
}
