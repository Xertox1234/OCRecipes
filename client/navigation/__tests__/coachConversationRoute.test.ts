import { describe, it, expect } from "vitest";
import {
  CommonActions,
  StackActions,
  StackRouter,
} from "@react-navigation/core";
import { getChatRouteId } from "../chatRouteId";
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

// The helpers only pick names and params; whether those land on the right
// screen is the Coach stack's doing. Run them through the REAL StackRouter (a
// pure reducer) for a Coach Pro user's stack, whose first screen is CoachPro.
describe("against the real Coach StackRouter (Coach Pro stack)", () => {
  const options = {
    routeNames: ["ChatList", "Chat", "CoachPro", "GroceryLists"],
    routeParamList: {},
    routeGetIdList: { Chat: getChatRouteId },
  };
  const router = StackRouter({ initialRouteName: "CoachPro" });
  const names = (state: { routes: { name: string }[] }) =>
    state.routes.map((route) => route.name);

  // Build a Coach stack by dispatching real navigate actions.
  function stackOf(...steps: [string, object | undefined][]) {
    let state = router.getInitialState(options);
    for (const [name, params] of steps) {
      const next = router.getStateForAction(
        state,
        CommonActions.navigate(name, params),
        options,
      );
      // A pushed route is always a full state; narrow on `stale`.
      if (!next || next.stale !== false) {
        throw new Error(`expected ${name} to be pushed`);
      }
      state = next;
    }
    return state;
  }

  it("the Coach Pro route pops back to the existing CoachPro and selects the conversation", () => {
    const state = stackOf(["GroceryLists", undefined]);
    expect(names(state)).toEqual(["CoachPro", "GroceryLists"]);
    const target = coachConversationParams(5, true);

    const next = router.getStateForAction(
      state,
      CommonActions.navigate({
        name: target.screen,
        params: target.params,
        pop: target.pop,
      }),
      options,
    )!;

    expect(names(next)).toEqual(["CoachPro"]);
    expect(next.routes[0].key).toBe(state.routes[0].key);
    expect(next.routes[0].params).toEqual({ selectedConversationId: 5 });
  });

  it("the Chat hand-off pops back to the CoachPro under it", () => {
    const state = stackOf(["Chat", { conversationId: 5 }]);
    expect(names(state)).toEqual(["CoachPro", "Chat"]);

    const next = router.getStateForAction(
      state,
      StackActions.popTo("CoachPro", { selectedConversationId: 5 }),
      options,
    )!;

    expect(names(next)).toEqual(["CoachPro"]);
    expect(next.routes[0].key).toBe(state.routes[0].key);
    expect(next.routes[0].params).toEqual({ selectedConversationId: 5 });
  });

  // ocrecipes://chat/5 on a cold launch builds a Coach stack holding only
  // Chat: there is no CoachPro to pop back to, so popTo swaps Chat for it.
  it("the Chat hand-off replaces a lone deep-linked Chat with CoachPro", () => {
    const state = router.getRehydratedState(
      { routes: [{ name: "Chat", params: { conversationId: 5 } }] },
      options,
    );
    expect(names(state)).toEqual(["Chat"]);

    const next = router.getStateForAction(
      state,
      StackActions.popTo("CoachPro", { selectedConversationId: 5 }),
      options,
    )!;

    expect(names(next)).toEqual(["CoachPro"]);
    expect(next.routes[0].params).toEqual({ selectedConversationId: 5 });
  });
});
