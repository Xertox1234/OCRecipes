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

  constructor(message: string, code?: string, status?: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}
