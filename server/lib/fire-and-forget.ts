import { logger, toError } from "./logger";

/**
 * Execute a promise in the background without blocking the caller.
 * Failures are logged with a context label for easier debugging.
 * AsyncLocalStorage context (requestId, userId) propagates automatically.
 *
 * @param label — identifies the operation in logs (e.g. "cache-hit-increment")
 * @param promise — the async operation to run in the background
 */
export function fireAndForget(label: string, promise: Promise<unknown>): void {
  promise.catch((err) =>
    logger.error(
      {
        err: toError(err),
        operation: label,
      },
      "background operation failed",
    ),
  );
}
