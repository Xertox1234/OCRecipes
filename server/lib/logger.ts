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
  serializers: {
    err: (err: unknown) => pino.stdSerializers.err(redactedError(err) as Error),
  },
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
 * log.info({ cacheHit: true }, "lookup finished");
 * // → { service: "nutrition-lookup", requestId: "...", userId: "...", cacheHit: true, msg: "lookup finished" }
 *
 * The mixin adds userId to every in-request line, so a field that names what
 * the user scanned, ate or typed (a barcode, a food name) is tied to them.
 * Keep such fields out of info, warn and error lines.
 */
export function createServiceLogger(service: string): pino.Logger {
  return logger.child({ service });
}

/**
 * Strip user values from a failed database statement's message. Drizzle ends
 * the message with "\nparams: <every bound value>" (password hashes, health
 * data, coach text), and pg puts the rejected input in its message for
 * type/enum/date errors (`... for type uuid: "<input>"`), so any quoted tail
 * after ': "' is redacted. Three more pg shapes quote the input mid-message;
 * each is redacted greedily up to its fixed suffix, so a quote inside the input
 * cannot end the redaction early. Quoted identifiers in other messages
 * (`relation "users" does not exist`) are kept.
 *
 * One function for the server log (the `err` serializer) and Sentry
 * (`scrubEvent`), so the two cannot drift.
 */
export function redactBoundValues(message: string): string {
  const paramsStart = message.indexOf("\nparams:");
  const head = paramsStart === -1 ? message : message.slice(0, paramsStart);
  // The mid-message rules run FIRST: an input containing ': "' would
  // otherwise let the tail cut eat the fixed suffix they match on.
  return (
    head
      // 22003: value "<input>" is out of range for type integer
      .replace(
        /\bvalue "[\s\S]*" is out of range for type\b/,
        'value "[redacted]" is out of range for type',
      )
      // 22023: time zone "<input>" not recognized
      .replace(
        /\btime zone "[\s\S]*" not recognized/,
        'time zone "[redacted]" not recognized',
      )
      // 22007 (to_date / to_timestamp): invalid value "<input>" for "<fmt>"
      .replace(
        /\binvalid value "[\s\S]*" for "/,
        'invalid value "[redacted]" for "',
      )
      .replace(/: "[\s\S]*$/, ': "[redacted]"')
  );
}

/**
 * A copy of a failed Drizzle statement's error that is safe to log: the
 * statement text and pg error code stay, the bound values and quoted inputs
 * (message, stack and the whole `cause` chain) go. Any other error is returned
 * untouched, so ordinary messages keep their detail.
 */
function redactedError(value: unknown): unknown {
  if (!(value instanceof Error)) return value;
  if (
    value.name !== "DrizzleQueryError" &&
    !value.message.includes("\nparams:")
  ) {
    return value;
  }
  return redactChain(value, new Set());
}

function redactChain(error: Error, seen: Set<unknown>): Error {
  const message = redactBoundValues(error.message);
  const safe = new Error(message);
  safe.name = error.name;
  safe.stack = error.stack?.replace(error.message, () => message);
  seen.add(error);
  if (error.cause instanceof Error && !seen.has(error.cause)) {
    safe.cause = redactChain(error.cause, seen);
  }
  // Drizzle's own error has no code; the pg error under it does. Hoist it so
  // pino's serializer (which only copies the top error's own fields) keeps it.
  const code =
    (error as Error & { code?: unknown }).code ??
    (safe.cause as (Error & { code?: unknown }) | undefined)?.code;
  if (code !== undefined) (safe as Error & { code?: unknown }).code = code;
  return safe;
}

/**
 * Normalize an unknown caught value into an Error instance.
 * Use in catch blocks: `logger.error({ err: toError(error) }, "message")`
 * A failed Drizzle statement comes back without its bound values.
 */
export function toError(value: unknown): Error {
  return redactedError(
    value instanceof Error ? value : new Error(String(value)),
  ) as Error;
}
