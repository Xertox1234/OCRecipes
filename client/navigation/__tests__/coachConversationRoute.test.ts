import { describe, it, expect } from "vitest";
import {
  coachConversationParams,
  shouldHandOffToCoachPro,
  showsCoachPro,
} from "../coachConversationRoute";

/**
 * Where "open this Coach conversation" lands. Coach Pro chats are drawn by
 * CoachPro (CoachChat), which shows a reply's write cards; the plain Chat
 * screen draws text only, so a Pro user sent there sees a card-less reply.
 */
describe("showsCoachPro", () => {
  it("is true for a Coach Pro user", () => {
    expect(showsCoachPro(true, true)).toBe(true);
  });

  it("is false for a free user once the plan is known", () => {
    expect(showsCoachPro(false, true)).toBe(false);
  });

  it("is true while the plan is still loading (owner ruling 2026-11-02)", () => {
    expect(showsCoachPro(false, false)).toBe(true);
  });
});

describe("coachConversationParams", () => {
  it("sends a Coach Pro user to CoachPro with the conversation selected, popping back to it", () => {
    expect(coachConversationParams(5, true)).toEqual({
      screen: "CoachPro",
      params: { selectedConversationId: 5 },
      pop: true,
    });
  });

  it("sends a free user to the plain Chat screen, as before", () => {
    expect(coachConversationParams(5, false)).toEqual({
      screen: "Chat",
      params: { conversationId: 5 },
      pop: true,
    });
  });
});

describe("shouldHandOffToCoachPro", () => {
  it("hands a Chat opened on a conversation over to CoachPro for a Pro user", () => {
    expect(shouldHandOffToCoachPro(5, true)).toBe(true);
  });

  it("keeps a free user on Chat", () => {
    expect(shouldHandOffToCoachPro(5, false)).toBe(false);
  });

  it("keeps a new chat (no id: the Weekly Report's initialMessage path) on Chat", () => {
    expect(shouldHandOffToCoachPro(null, true)).toBe(false);
  });

  it("keeps a malformed link id (0 or negative) on Chat, which shows its error", () => {
    expect(shouldHandOffToCoachPro(0, true)).toBe(false);
    expect(shouldHandOffToCoachPro(-3, true)).toBe(false);
  });
});
