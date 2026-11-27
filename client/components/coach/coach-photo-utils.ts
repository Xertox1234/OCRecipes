import { ErrorCode } from "@shared/constants/error-codes";
import { ApiError } from "@/lib/api-error";
import { UploadNoAnswerError } from "@/lib/upload-no-answer";

export interface CoachPhotoFailure {
  /** Show the chat's daily-limit banner instead of an error line. */
  atDailyLimit: boolean;
  /** Static copy for the inline error; null when nothing should show. */
  message: string | null;
  /**
   * The photo upload got no answer from the server (`UploadNoAnswerError`),
   * so the server may still have received it and be working on it. The chat
   * keeps checking for the result instead of asking for a resend.
   */
  maybeSaved: boolean;
}

/** What was sent: a photo, or a barcode read by the live scanner. */
export type CoachSendKind = "photo" | "barcode";

/** Shown when the photo upload got no answer; never asks for a resend. */
const PHOTO_UNCONFIRMED =
  "That photo may not have gone through. If it did, the result will appear here shortly.";

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
      // The Coach photo routes use the shared 1 MB multer upload, whose 400
      // keeps multer's own code (server/routes/_upload.ts handleUploadError).
      case "LIMIT_FILE_SIZE":
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
  }
  if (err instanceof UploadNoAnswerError) {
    return {
      atDailyLimit: false,
      message: PHOTO_UNCONFIRMED,
      maybeSaved: true,
    };
  }
  // The server answered with something else, or nothing was sent at all.
  return { atDailyLimit: false, message: copy.fallback, maybeSaved: false };
}
