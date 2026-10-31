/**
 * Pure copy and constants for the cover studio on the New Cookbook flow's
 * Cover step. No React here, so Vitest covers it without rendering.
 */
import { ApiError } from "@/lib/api-error";
import { ErrorCode } from "@shared/constants/error-codes";

/** Idea chips under "Describe your cover"; a tap fills the field. */
export const COVER_IDEAS = [
  "Fresh pasta on a floured wooden board",
  "Grandma's kitchen table at Sunday lunch",
  "Warm bread and herbs in morning light",
  "Summer berries on white linen",
  "A spread of spices on dark slate",
] as const;

export function generateButtonLabel(
  pending: boolean,
  hasCandidates: boolean,
): string {
  if (pending) return "Generating…";
  return hasCandidates ? "Generate 4 more" : "Generate 4 covers";
}

const GENERIC = "Couldn't make covers right now. Try again.";

/**
 * Static, user-safe copy for a failed set. Never the raw `ApiError.message` —
 * that is the server body with a status prefix; branch on `.code` instead.
 */
export function coverStudioErrorCopy(err: unknown): string {
  if (!(err instanceof ApiError)) return GENERIC;
  switch (err.code) {
    case ErrorCode.DAILY_LIMIT_REACHED:
      return "You've made a lot of covers today. Try again tomorrow.";
    case ErrorCode.RATE_LIMITED:
      return "Give it a moment, then try again.";
    case ErrorCode.PREMIUM_REQUIRED:
      return "AI covers are a premium feature.";
    default:
      return GENERIC;
  }
}
