import type { AiSharingStatus } from "@shared/lib/ai-sharing";

/**
 * True when the AI-sharing question must be answered before anything else
 * (privacy audit H3). An unknown status (still loading, or offline) does not
 * block the app: the server refuses AI requests on its own until the answer
 * is yes, so nothing is sent in the meantime.
 */
export function needsAiSharingAnswer(
  isAuthenticated: boolean,
  status: AiSharingStatus | undefined,
): boolean {
  return isAuthenticated && status !== undefined && !status.answered;
}

/** True when a refused AI request should open the question again. */
export function shouldReask(currentRouteName: string | undefined): boolean {
  return currentRouteName !== undefined && currentRouteName !== "AiSharing";
}
