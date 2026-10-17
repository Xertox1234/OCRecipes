import { ApiError } from "@/lib/api-error";
import { ErrorCode } from "@shared/constants/error-codes";

/**
 * Map a URL-import failure to user-facing copy. The server sends every import
 * failure as HTTP 422, so the message can't tell them apart — branch on
 * `ApiError.code` instead.
 */
export function urlImportErrorCopy(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case ErrorCode.FETCH_FAILED:
        return "Could not fetch the URL. Check the link and try again.";
      case ErrorCode.TIMEOUT:
        return "That page took too long to load. Try again in a moment.";
      case ErrorCode.RESPONSE_TOO_LARGE:
        return "That page is too large to import.";
      case ErrorCode.NO_RECIPE_DATA:
      case ErrorCode.PARSE_ERROR:
        return "No recipe data found on this page.";
      case ErrorCode.RATE_LIMITED:
        return "Too many requests. Please wait a moment and try again.";
    }
  }
  return "Something went wrong. Please try again.";
}
