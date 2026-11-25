import { ErrorCode } from "@shared/constants/error-codes";
import { ApiError } from "@/lib/api-error";

export interface CoachPhotoFailure {
  /** Show the chat's daily-limit banner instead of an error line. */
  atDailyLimit: boolean;
  /** Static copy for the inline error; null when nothing should show. */
  message: string | null;
  /**
   * The server never answered (a dropped or timed-out connection), so it may
   * still have received the send and be working on it. The chat keeps
   * checking for the result instead of asking for a resend.
   */
  maybeSaved: boolean;
}

/** What was sent: a photo, or a barcode read by the live scanner. */
export type CoachSendKind = "photo" | "barcode";

const COPY = {
  photo: {
    rateLimited: "Too many photos at once. Please wait a moment and try again.",
    inFlight: "The Coach is still answering. Send the photo after the reply.",
    premium: "Sending photos to the Coach needs Coach Pro.",
    fallback: "Couldn't send that photo. Please try again.",
    unconfirmed:
      "That photo may not have gone through. If it did, the result will appear here shortly.",
  },
  barcode: {
    rateLimited: "Too many scans at once. Please wait a moment and try again.",
    inFlight: "The Coach is still answering. Scan again after the reply.",
    premium: "Scanning for the Coach needs Coach Pro.",
    fallback: "Couldn't send that barcode. Please try again.",
    unconfirmed:
      "That barcode may not have gone through. If it did, the result will appear here shortly.",
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
        return { atDailyLimit: true, message: null, maybeSaved: false };
      case ErrorCode.AI_SHARING_REQUIRED:
        // photo-upload raises the AI-sharing prompt itself.
        return { atDailyLimit: false, message: null, maybeSaved: false };
      case ErrorCode.RATE_LIMITED:
        return {
          atDailyLimit: false,
          message: copy.rateLimited,
          maybeSaved: false,
        };
      case ErrorCode.IMAGE_TOO_LARGE:
        return {
          atDailyLimit: false,
          message: "This photo is too large to send. Please try another.",
          maybeSaved: false,
        };
      case ErrorCode.REQUEST_IN_FLIGHT:
        // Another turn in this conversation has not been answered yet.
        return {
          atDailyLimit: false,
          message: copy.inFlight,
          maybeSaved: false,
        };
      case ErrorCode.PREMIUM_REQUIRED:
        return {
          atDailyLimit: false,
          message: copy.premium,
          maybeSaved: false,
        };
    }
    // The server answered with something else: the send did fail.
    return { atDailyLimit: false, message: copy.fallback, maybeSaved: false };
  }
  // No answer at all. The send has no reply until the analysis is done, so
  // this says nothing about whether the server received it.
  return { atDailyLimit: false, message: copy.unconfirmed, maybeSaved: true };
}
