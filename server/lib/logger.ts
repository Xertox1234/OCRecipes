import pino from "pino";
import { getRequestContext } from "./request-context";

const isProduction = process.env.NODE_ENV === "production";
const defaultLevel = isProduction ? "info" : "debug";

/**
 * Root pino instance.
 * - JSON output in production (for log aggregators)
 * - pino-pretty in development (human-readable)
 */
export const rootLogger = pino({
  level: process.env.LOG_LEVEL || defaultLevel,
  ...(isProduction ? {} : { transport: { target: "pino-pretty" } }),
});

type LogFn = pino.LogFn;

/**
 * Creates a logger proxy that automatically merges AsyncLocalStorage
 * request context (requestId, userId) into every log call.
 *
 * Supports both calling forms:
 *   logger.info("message")
 *   logger.info({ key: "value" }, "message")
 */
function createContextLogger(base: pino.Logger): pino.Logger {
  const LOG_METHODS = [
    "fatal",
    "error",
    "warn",
    "info",
    "debug",
    "trace",
  ] as const;

  const handler: ProxyHandler<pino.Logger> = {
    get(target, prop, receiver) {
      if (prop === "child") {
        return (bindings: pino.Bindings) =>
          createContextLogger(target.child(bindings));
      }

      if (
        typeof prop === "string" &&
        LOG_METHODS.includes(prop as (typeof LOG_METHODS)[number])
      ) {
        const originalMethod = target[prop as keyof pino.Logger] as LogFn;

        return function contextAwareLog(
          this: pino.Logger,
          ...args: Parameters<LogFn>
        ) {
          const ctx = getRequestContext();
          if (!ctx) {
            return originalMethod.apply(target, args);
          }

          const ctxBindings: Record<string, unknown> = {
            requestId: ctx.requestId,
          };
          if (ctx.userId) {
            ctxBindings.userId = ctx.userId;
          }

          // logger.info("message") → logger.info({ ...ctx }, "message")
          // logger.info({ data }, "message") → logger.info({ ...ctx, ...data }, "message")
          if (typeof args[0] === "string") {
            return originalMethod.call(target, ctxBindings, args[0]);
          }

          if (typeof args[0] === "object" && args[0] !== null) {
            const merged = { ...ctxBindings, ...(args[0] as object) };
            return originalMethod.call(
              target,
              merged,
              ...(args.slice(1) as [string]),
            );
          }

          return originalMethod.apply(target, args);
        };
      }

      return Reflect.get(target, prop, receiver);
    },
  };

  return new Proxy(base, handler);
}

/**
 * Context-aware logger. Automatically includes requestId and userId
 * from AsyncLocalStorage when called within a request context.
 * Falls back to root logger (no request fields) outside requests.
 */
export const logger = createContextLogger(rootLogger);

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
