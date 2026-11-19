import { ErrorCode } from "@shared/constants/error-codes";
import { ApiError, isDuplicateInFlight } from "@/lib/api-error";

/**
 * What the generate sheet says when the server refuses to make a list.
 * Only refusals (4xx) get a message here: the global mutation toast skips
 * them, so without this the sheet just stops spinning. A server error already
 * has the global toast, and a double tap is owned by the first request, so
 * both return null.
 */
export function groceryGenerateErrorMessage(err: unknown): string | null {
  if (!(err instanceof ApiError) || isDuplicateInFlight(err)) return null;
  if (err.status === undefined || err.status >= 500) return null;
  // The range's items would not fit on one list (the per-list item cap the
  // generate route checks since #1930).
  if (err.code === ErrorCode.LIMIT_REACHED) {
    return "Too many items for one list. Choose fewer days.";
  }
  if (err.code === ErrorCode.DATE_RANGE_LIMIT) {
    return "That's more days than your plan allows. Choose fewer days.";
  }
  // The 50-list cap arrives as a plain VALIDATION_ERROR, shared with other
  // bad-input refusals, so name it here rather than promise a retry helps.
  return "Couldn't make that list. If you have 50 lists, delete one first.";
}
