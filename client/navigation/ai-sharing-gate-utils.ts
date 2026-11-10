/**
 * True when a refused AI request should open the AI-sharing question
 * (privacy audit H3): not when it is already open.
 */
export function shouldReask(currentRouteName: string | undefined): boolean {
  return currentRouteName !== undefined && currentRouteName !== "AiSharing";
}
