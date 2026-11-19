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
  if (err.code === "LIMIT_REACHED") {
    return "Too many items for one list. Choose fewer days.";
  }
  if (err.code === "DATE_RANGE_LIMIT") {
    return "That's more days than your plan allows. Choose fewer days.";
  }
  return "Couldn't make that list. Please try again.";
}
