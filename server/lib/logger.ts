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
    err: errSerializer,
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

const REDACTED_MESSAGE_MAX = 10_000;

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
  // Capped: the greedy rules below are quadratic on a message that repeats
  // their opening token, and a log line has no use for more.
  const head = (
    paramsStart === -1 ? message : message.slice(0, paramsStart)
  ).slice(0, REDACTED_MESSAGE_MAX);
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

type ErrorFields = Error & {
  code?: unknown;
  severity?: unknown;
  detail?: unknown;
  where?: unknown;
  errors?: unknown;
};

/**
 * True for an error whose own text or fields carry user values: a failed
 * Drizzle statement (its message ends with the bound values) or a pg error
 * (`detail` and `where` quote row values, and its message can quote the
 * rejected input).
 */
function carriesBoundValues(error: ErrorFields): boolean {
  return (
    error.name === "DrizzleQueryError" ||
    error.message.includes("\nparams:") ||
    typeof error.severity === "string" ||
    typeof error.detail === "string" ||
    typeof error.where === "string"
  );
}

function nestedErrors(error: ErrorFields): Error[] {
  const nested: Error[] = [];
  if (error.cause instanceof Error) nested.push(error.cause);
  if (Array.isArray(error.errors)) {
    for (const item of error.errors)
      if (item instanceof Error) nested.push(item);
  }
  return nested;
}

/** Whether the error, or anything under it (`cause`, `errors`), needs redacting. */
function needsRedaction(error: Error, seen: Set<Error>): boolean {
  if (seen.has(error)) return false;
  seen.add(error);
  return (
    carriesBoundValues(error) ||
    nestedErrors(error).some((nested) => needsRedaction(nested, seen))
  );
}

/**
 * A copy of an error that is safe to log when it, or an error under it, is a
 * failed database statement: the statement text and pg error code stay, the
 * bound values, quoted inputs and pg `detail`/`where` go — in the message, the
 * stack, the whole `cause` chain and an AggregateError's `errors`. Any other
 * error is returned untouched, so ordinary messages keep their detail.
 */
function redactedError(value: unknown): unknown {
  if (!(value instanceof Error)) return value;
  if (!needsRedaction(value, new Set())) return value;
  return redactChain(value, new Set());
}

function redactChain(error: ErrorFields, seen: Set<unknown>): Error {
  seen.add(error);
  // Every message in the tree is redacted, not only the failed statement's:
  // the pg error beneath a Drizzle one need not look like one, and a wrapper
  // above it may repeat its message.
  const message = redactBoundValues(error.message);
  const safe: ErrorFields = new Error(message);
  safe.name = error.name;
  safe.stack = error.stack?.replace(error.message, () => message);
  if (error.cause instanceof Error && !seen.has(error.cause)) {
    safe.cause = redactChain(error.cause, seen);
  }
  if (Array.isArray(error.errors)) {
    safe.errors = error.errors
      .filter((item): item is Error => item instanceof Error && !seen.has(item))
      .map((item) => redactChain(item, seen));
  }
  // Drizzle's own error has no code; the pg error under it does. Hoist it so
  // pino's serializer (which only copies the top error's own fields) keeps it.
  const code = error.code ?? (safe.cause as ErrorFields | undefined)?.code;
  if (code !== undefined) safe.code = code;
  return safe;
}

/** The logger's `err` serializer; pino-http needs it passed in again. */
export function errSerializer(err: unknown) {
  return pino.stdSerializers.err(redactedError(err) as Error);
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
