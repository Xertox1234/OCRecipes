/**
 * Where "open this Coach conversation" lands, extracted for testability (no
 * React or RN dependencies). Coach Pro chats are drawn by CoachPro
 * (CoachChat), which shows a reply's write cards; the plain Chat screen draws
 * text only, so a Coach Pro user sent there sees a reply with its card
 * missing.
 */

/**
 * Whether Coach routes go to CoachPro. While the plan is unknown (loading, or
 * a failed check whose features read free) keep Coach Pro routing, so a Coach
 * Pro user is never routed to Chat (owner ruling 2026-11-02; CoachProScreen
 * assumes access until the plan is known too).
 */
export function showsCoachPro(
  isCoachPro: boolean,
  isPremiumResolved: boolean,
): boolean {
  return isCoachPro || !isPremiumResolved;
}

export type CoachConversationParams =
  | {
      screen: "CoachPro";
      params: { selectedConversationId: number };
      pop: true;
    }
  | { screen: "Chat"; params: { conversationId: number }; pop: true };

/**
 * The Coach-stack half of the route to a conversation (the caller wraps it in
 * Main → CoachTab). `pop: true` is the one the Coach stack sees: it returns
 * to the existing CoachPro, or to an existing Chat for that conversation
 * (found via Chat's `getId`), instead of pushing a second copy.
 */
export function coachConversationParams(
  conversationId: number,
  showCoachPro: boolean,
): CoachConversationParams {
  return showCoachPro
    ? {
        screen: "CoachPro",
        params: { selectedConversationId: conversationId },
        pop: true,
      }
    : { screen: "Chat", params: { conversationId }, pop: true };
}

/**
 * Whether a Chat screen opened on `openedConversationId` should hand over to
 * CoachPro. This is what catches the `ocrecipes://chat/<id>` link, whose
 * route is fixed in linking.ts before the plan can be read.
 *
 * Pass the id the screen was OPENED with, not its live one: a new chat (no
 * id, e.g. the Weekly Report's initialMessage path) gains an id after its
 * first send, and must stay where it is. A malformed link id (0 or negative)
 * stays on Chat, which shows the error for it.
 */
export function shouldHandOffToCoachPro(
  openedConversationId: number | null,
  showCoachPro: boolean,
): boolean {
  return (
    showCoachPro && openedConversationId !== null && openedConversationId > 0
  );
}
