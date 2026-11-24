import { ErrorCode } from "@shared/constants/error-codes";
import { ApiError } from "@/lib/api-error";

export interface CoachPhotoFailure {
  /** Show the chat's daily-limit banner instead of an error line. */
  atDailyLimit: boolean;
  /** Static copy for the inline error; null when nothing should show. */
  message: string | null;
}

/** What was sent: a photo, or a barcode read by the live scanner. */
export type CoachSendKind = "photo" | "barcode";

const COPY = {
  photo: {
    rateLimited: "Too many photos at once. Please wait a moment and try again.",
    inFlight: "The Coach is still answering. Send the photo after the reply.",
    premium: "Sending photos to the Coach needs Coach Pro.",
    fallback: "Couldn't send that photo. Please try again.",
  },
  barcode: {
    rateLimited: "Too many scans at once. Please wait a moment and try again.",
    inFlight: "The Coach is still answering. Scan again after the reply.",
    premium: "Scanning for the Coach needs Coach Pro.",
    fallback: "Couldn't send that barcode. Please try again.",
  },
} as const;

/**
 * What to show when sending a photo or a scanned barcode to the Coach fails.
 * Branches on the server's error code and never renders the raw error text.
 */
export function coachPhotoFailure(
  err: unknown,
  kind: CoachSendKind = "photo",
): CoachPhotoFailure {
  const copy = COPY[kind];
  if (err instanceof ApiError) {
    switch (err.code) {
      case ErrorCode.DAILY_LIMIT_REACHED:
        return { atDailyLimit: true, message: null };
      case ErrorCode.AI_SHARING_REQUIRED:
        // photo-upload raises the AI-sharing prompt itself.
        return { atDailyLimit: false, message: null };
      case ErrorCode.RATE_LIMITED:
        return { atDailyLimit: false, message: copy.rateLimited };
      case ErrorCode.IMAGE_TOO_LARGE:
        return {
          atDailyLimit: false,
          message: "This photo is too large to send. Please try another.",
        };
      case ErrorCode.REQUEST_IN_FLIGHT:
        // Another turn in this conversation has not been answered yet.
        return { atDailyLimit: false, message: copy.inFlight };
      case ErrorCode.PREMIUM_REQUIRED:
        return { atDailyLimit: false, message: copy.premium };
    }
  }
  return { atDailyLimit: false, message: copy.fallback };
}
