import pino from "pino";
import { getRequestContext } from "./request-context";

const isProduction = process.env.NODE_ENV === "production";
const defaultLevel = isProduction ? "info" : "debug";

/**
 * Root pino instance.
 * - JSON output in production (for log aggregators)
 * - pino-pretty in development (human-readable)
 * - mixin injects requestId/userId from AsyncLocalStorage on every log call
 */
export const rootLogger = pino({
  level: process.env.LOG_LEVEL || defaultLevel,
  ...(isProduction ? {} : { transport: { target: "pino-pretty" } }),
  mixin() {
    const ctx = getRequestContext();
    if (!ctx) return {};
    return ctx.userId
      ? { requestId: ctx.requestId, userId: ctx.userId }
      : { requestId: ctx.requestId };
  },
});

/**
 * Context-aware logger. Automatically includes requestId and userId
 * from AsyncLocalStorage when called within a request context.
 * Falls back to root logger (no request fields) outside requests.
 *
 * This is the same instance as rootLogger — the mixin applies to all
 * log calls including child loggers created via .child().
 */
export const logger = rootLogger;

/**
 * Create a child logger with a baked-in service name.
 * Useful for service modules that want filterable `service` field.
 *
 * @example
 * const log = createServiceLogger("nutrition-lookup");
 * log.info({ barcode }, "starting lookup");
 * // → { service: "nutrition-lookup", requestId: "...", barcode: "...", msg: "starting lookup" }
 */
export function createServiceLogger(service: string): pino.Logger {
  return logger.child({ service });
}

/**
 * Normalize an unknown caught value into an Error instance.
 * Use in catch blocks: `logger.error({ err: toError(error) }, "message")`
 */
export function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
