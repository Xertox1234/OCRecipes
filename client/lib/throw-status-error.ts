import { ApiError } from "./api-error";
import { ErrorCode } from "@shared/constants/error-codes";

/**
 * Throw a code-carrying `ApiError` from a status-only query failure.
 *
 * In production `apiRequest` already throws an `ApiError` (with the server's
 * parsed `code`) before a hook's own `if (!res.ok)` guard runs, so this is
 * exercised mainly by tests that mock `apiRequest`; throwing an `ApiError` here
 * keeps the test and production error contracts aligned so screens can branch
 * on `.code` instead of a fragile status-string message comparison.
 */
export function throwStatusError(status: number): never {
  const code = status === 404 ? ErrorCode.NOT_FOUND : ErrorCode.INTERNAL_ERROR;
  throw new ApiError(status === 404 ? "Not found" : "Request failed", code);
}
