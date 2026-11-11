import { navigationRef } from "@/navigation/navigationRef";

/**
 * Open a Coach conversation from anywhere, including from under a root modal.
 * `navigationRef` sits outside every navigator, so the route is spelled out
 * (Main → CoachTab → Chat): a bare `navigate("Chat")` is silently dropped
 * because Chat is not on the outward path from the root. `pop: true` returns
 * to the EXISTING Main (dismissing any root modal above it) — without it a tap
 * while a modal is open pushes a second Main. The outer `pop` stops at the
 * root stack; the nested one is what the Coach stack sees (it pops back to an
 * existing Chat for that conversation, found via Chat's `getId`). See
 * docs/solutions/logic-errors/bare-navigate-cannot-descend-into-an-unrelated-nested-navigator-2026-09-29.md.
 *
 * Its own module (not MainTabNavigator) so screens and components can import
 * it without pulling in the tab navigator.
 */
export function openCoachConversation(conversationId: number): void {
  if (!navigationRef.isReady()) return;
  navigationRef.navigate(
    "Main",
    {
      screen: "CoachTab",
      params: { screen: "Chat", params: { conversationId }, pop: true },
    },
    { pop: true },
  );
}

/**
 * Open a NEW Coach chat that starts with `message` (sent as the user's first
 * message). Same root-spelled route as openCoachConversation.
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
