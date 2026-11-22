/**
 * Where "open this Coach conversation" lands, extracted for testability (no
 * React or RN dependencies). Coach Pro chats are drawn by CoachPro (CoachChat),
 * which shows a reply's write cards; the plain Chat screen draws text only, so
 * a Pro user sent there would see a card-less reply.
 */

/**
 * The AllConversationsScreen rule: Coach Pro routing for a Pro user, and also
 * while the plan is unknown (loading, or a failed check whose features read
 * free) — owner ruling 2026-11-02.
 */
export function showsCoachPro(
  isCoachPro: boolean,
  isPremiumResolved: boolean,
): boolean {
  return isCoachPro || !isPremiumResolved;
}

/**
 * The Coach-stack half of the route (what goes under Main → CoachTab).
 * `pop: true` returns to an existing screen of that name instead of pushing a
 * second one; on an existing CoachPro it replaces the params, so
 * `selectedConversationId` arrives and CoachPro consumes it.
 */
export function coachConversationParams(
  conversationId: number,
  toCoachPro: boolean,
):
  | {
      screen: "CoachPro";
      params: { selectedConversationId: number };
      pop: true;
    }
  | { screen: "Chat"; params: { conversationId: number }; pop: true } {
  return toCoachPro
    ? {
        screen: "CoachPro",
        params: { selectedConversationId: conversationId },
        pop: true,
      }
    : { screen: "Chat", params: { conversationId }, pop: true };
}

/**
 * A Chat screen opened on a conversation (the `ocrecipes://chat/<id>` deep
 * link) hands it over to CoachPro for a Pro user. Pass the id the screen was
 * OPENED with, not the live one: a new chat's first send sets `conversationId`
 * on the route, and handing off then would pull the user out mid-reply.
 * `isCoachPro` must be the resolved plan — the hand-off is one-way, so it
 * waits for the plan rather than assuming Pro.
 */
export function shouldHandOffToCoachPro(
  openedConversationId: number | null,
  isCoachPro: boolean,
): boolean {
  return (
    isCoachPro && openedConversationId !== null && openedConversationId > 0
  );
}
