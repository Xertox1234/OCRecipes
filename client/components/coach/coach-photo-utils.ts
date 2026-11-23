import { ErrorCode } from "@shared/constants/error-codes";
import { ApiError } from "@/lib/api-error";

export interface CoachPhotoFailure {
  /** Show the chat's daily-limit banner instead of an error line. */
  atDailyLimit: boolean;
  /** Static copy for the inline error; null when nothing should show. */
  message: string | null;
}

/**
 * What to show when sending a photo to the Coach fails. Branches on the
 * server's error code and never renders the raw error text.
 */
export function coachPhotoFailure(err: unknown): CoachPhotoFailure {
  if (err instanceof ApiError) {
    switch (err.code) {
      case ErrorCode.DAILY_LIMIT_REACHED:
        return { atDailyLimit: true, message: null };
      case ErrorCode.AI_SHARING_REQUIRED:
        // photo-upload raises the AI-sharing prompt itself.
        return { atDailyLimit: false, message: null };
      case ErrorCode.RATE_LIMITED:
        return {
          atDailyLimit: false,
          message:
            "Too many photos at once. Please wait a moment and try again.",
        };
      case ErrorCode.IMAGE_TOO_LARGE:
        return {
          atDailyLimit: false,
          message: "This photo is too large to send. Please try another.",
        };
      case ErrorCode.PREMIUM_REQUIRED:
        return {
          atDailyLimit: false,
          message: "Sending photos to the Coach needs Coach Pro.",
        };
    }
  }
  return {
    atDailyLimit: false,
    message: "Couldn't send that photo. Please try again.",
  };
}
