import { logger, toError } from "./logger";
import { reportError } from "./error-reporter";

/**
 * Execute a promise in the background without blocking the caller.
 * Failures are logged with a context label for easier debugging, and reported
 * to the error reporter — a failed background job raises no uncaught error,
 * so it reaches Sentry only through this catch (the explicit reportError, and
 * the error-level log via pinoIntegration; the SDK dedupes the shared Error).
 * AsyncLocalStorage context (requestId, userId) propagates automatically.
 *
 * @param label — identifies the operation in logs (e.g. "cache-hit-increment")
 * @param promise — the async operation to run in the background
 */
export function fireAndForget(label: string, promise: Promise<unknown>): void {
  promise.catch((err) => {
    // One Error object for both sinks: pinoIntegration captures the logged
    // `err`, and the SDK skips an object it already captured — so a non-Error
    // rejection wrapped twice would become two Sentry events.
    const error = toError(err);
    logger.error(
      {
        err: error,
        operation: label,
      },
      "background operation failed",
    );
    reportError(error, label);
  });
}
