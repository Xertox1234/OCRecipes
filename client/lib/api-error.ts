import { ErrorCode } from "@shared/constants/error-codes";

/**
 * Custom error class for API responses with machine-readable error codes.
 */
export class ApiError extends Error {
  code?: string;
  /**
   * The numeric HTTP status of the failed response (e.g. 404, 429, 500), set by
   * `throwIfResNotOk`. Lets callers branch on the status class (4xx vs 5xx)
   * directly instead of regexing the `message` string. Optional because some
   * `ApiError` producers (client-side validation, upload helpers) have no HTTP
   * status to attach.
   */
  status?: number;
  /**
   * The server's `X-Request-Id` for the failed response, set by
   * `throwIfResNotOk`. `reportError` tags the Sentry event with it so an app
   * report can be matched to the server's log line for the same request
   * (reliability audit 2026-11-19, L-obs-3). A random UUID — not PII.
   */
  requestId?: string;

  constructor(message: string, code?: string, status?: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

/**
 * True for the server's refusal of a duplicate request while the first is
 * still saving (a double tap). The first request owns the success or failure,
 * so the caller shows nothing for this one.
 */
export function isDuplicateInFlight(err: unknown): boolean {
  return err instanceof ApiError && err.code === ErrorCode.REQUEST_IN_FLIGHT;
}

/**
 * A request refused before it was sent because the device is offline. A
 * mutation with `networkMode: "always"` throws this instead of pausing until
 * reconnect, where it would fire for a screen that is gone (reliability audit
 * 2026-11-19, L-crel-2). The global mutation net never reports it.
 */
export class OfflineError extends Error {
  constructor() {
    super("You're offline");
    this.name = "OfflineError";
  }
}
