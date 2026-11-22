import { navigationRef } from "@/navigation/navigationRef";
import { coachConversationParams } from "@/navigation/coachConversationRoute";

/**
 * Open a Coach conversation from anywhere, including from under a root modal.
 * `navigationRef` sits outside every navigator, so the route is spelled out
 * (Main → CoachTab → CoachPro or Chat): a bare `navigate("Chat")` is silently
 * dropped because Chat is not on the outward path from the root. `pop: true`
 * returns to the EXISTING Main (dismissing any root modal above it) — without
 * it a tap while a modal is open pushes a second Main. The outer `pop` stops
 * at the root stack; the nested one is what the Coach stack sees (see
 * coachConversationParams). See
 * docs/solutions/logic-errors/bare-navigate-cannot-descend-into-an-unrelated-nested-navigator-2026-09-29.md.
 *
 * `showCoachPro` picks the screen: this runs outside React, so the caller
 * reads the plan (`useShowsCoachPro`) and passes it in. A Coach Pro user goes
 * to CoachPro, which draws a reply's cards; the plain Chat screen does not.
 *
 * Its own module (not MainTabNavigator) so screens and components can import
 * it without pulling in the tab navigator.
 */
export function openCoachConversation(
  conversationId: number,
  showCoachPro: boolean,
): void {
  if (!navigationRef.isReady()) return;
  navigationRef.navigate(
    "Main",
    {
      screen: "CoachTab",
      params: coachConversationParams(conversationId, showCoachPro),
    },
    { pop: true },
  );
}

/**
 * Open a NEW Coach chat that starts with `message` (sent as the user's first
 * message). Same root-spelled route as openCoachConversation. It opens the
 * plain Chat screen for every plan: only Chat takes an `initialMessage`
 * (CoachPro has no such param), and a chat opened this way stays on Chat
 * after its first send (see shouldHandOffToCoachPro).
 */
export function openCoachWithMessage(message: string): void {
  if (!navigationRef.isReady()) return;
  navigationRef.navigate(
    "Main",
    {
      screen: "CoachTab",
      params: {
        screen: "Chat",
        params: { initialMessage: message },
        pop: true,
      },
    },
    { pop: true },
  );
}
