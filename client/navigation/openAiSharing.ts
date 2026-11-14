import { navigationRef } from "@/navigation/navigationRef";

/**
 * Open the AI-sharing question (privacy audit H3) from anywhere. It is a root
 * screen, so it goes through `navigationRef` rather than a nested navigator's
 * `navigate`. Its own module so screens can import it without the navigator.
 */
export function openAiSharing(): void {
  if (!navigationRef.isReady()) return;
  navigationRef.navigate("AiSharing");
}
