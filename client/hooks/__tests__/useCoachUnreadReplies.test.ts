// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";

import {
  UNREAD_COACH_REPLIES_KEY,
  VIEWED_COACH_CONVERSATION_KEY,
  clearCoachReplyUnread,
  getUnreadCoachReplyIds,
  getViewedCoachConversation,
  markCoachReplyUnread,
  noteCoachReplyFinished,
  subscribeToCoachReplyReady,
  useHasUnreadCoachReply,
  viewCoachConversation,
} from "../useCoachUnreadReplies";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";

describe("unread marks", () => {
  it("records a conversation once, however many replies land unseen", () => {
    const { queryClient } = createQueryWrapper();

    markCoachReplyUnread(queryClient, 5);
    markCoachReplyUnread(queryClient, 5);
    markCoachReplyUnread(queryClient, 8);

    expect(getUnreadCoachReplyIds(queryClient)).toEqual([5, 8]);
  });

  it("clears one conversation's mark and keeps the others", () => {
    const { queryClient } = createQueryWrapper();
    markCoachReplyUnread(queryClient, 5);
    markCoachReplyUnread(queryClient, 8);

    clearCoachReplyUnread(queryClient, 5);

    expect(getUnreadCoachReplyIds(queryClient)).toEqual([8]);
  });

  // setQueryData(key, undefined) is a no-op that leaves the previous value in
  // place (query-cache-as-ephemeral-client-store solution), so an emptied list
  // must be written as [] or the red dot would never go away.
  it("writes [] (not undefined) when the last mark clears", () => {
    const { queryClient } = createQueryWrapper();
    markCoachReplyUnread(queryClient, 5);

    clearCoachReplyUnread(queryClient, 5);

    expect(queryClient.getQueryData(UNREAD_COACH_REPLIES_KEY)).toEqual([]);
    expect(getUnreadCoachReplyIds(queryClient)).toEqual([]);
  });

  it("ignores a clear for a conversation with no mark, without creating the entry", () => {
    const { queryClient } = createQueryWrapper();

    clearCoachReplyUnread(queryClient, 5);

    expect(queryClient.getQueryData(UNREAD_COACH_REPLIES_KEY)).toBeUndefined();
  });
});

describe("viewing a conversation", () => {
  it("records the conversation on screen", () => {
    const { queryClient } = createQueryWrapper();
    expect(getViewedCoachConversation(queryClient)).toBeNull();

    viewCoachConversation(queryClient, 5);

    expect(getViewedCoachConversation(queryClient)).toBe(5);
  });

  it("clears that conversation's unread mark, and only that one's", () => {
    const { queryClient } = createQueryWrapper();
    markCoachReplyUnread(queryClient, 5);
    markCoachReplyUnread(queryClient, 8);

    viewCoachConversation(queryClient, 5);

    expect(getUnreadCoachReplyIds(queryClient)).toEqual([8]);
  });

  it("leaving clears the conversation on screen (null, never undefined)", () => {
    const { queryClient } = createQueryWrapper();
    const leave = viewCoachConversation(queryClient, 5);

    leave?.();

    expect(getViewedCoachConversation(queryClient)).toBeNull();
    expect(queryClient.getQueryData(VIEWED_COACH_CONVERSATION_KEY)).toBeNull();
  });

  // The new-chat flow has no conversation id until the first send creates one.
  it("registers nothing for a null id and hands back no leave function", () => {
    const { queryClient } = createQueryWrapper();

    expect(viewCoachConversation(queryClient, null)).toBeUndefined();

    expect(
      queryClient.getQueryData(VIEWED_COACH_CONVERSATION_KEY),
    ).toBeUndefined();
  });

  // The screen re-points at another conversation (a toast tap while on a chat):
  // React runs the old effect's cleanup before the new effect, but a navigator
  // can also emit the old screen's blur after the new one's focus. Either
  // order must leave the NEW conversation recorded.
  it("an old conversation's leave does not clobber a newer view", () => {
    const { queryClient } = createQueryWrapper();
    const leaveFirst = viewCoachConversation(queryClient, 5);
    viewCoachConversation(queryClient, 8);

    leaveFirst?.();

    expect(getViewedCoachConversation(queryClient)).toBe(8);
  });
});

describe("noteCoachReplyFinished", () => {
  it("records nothing and tells no one while the user is on that conversation", () => {
    const { queryClient } = createQueryWrapper();
    const listener = vi.fn();
    const unsubscribe = subscribeToCoachReplyReady(listener);
    viewCoachConversation(queryClient, 5);

    noteCoachReplyFinished(queryClient, 5);

    expect(getUnreadCoachReplyIds(queryClient)).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("marks the conversation and tells subscribers when nothing is on screen", () => {
    const { queryClient } = createQueryWrapper();
    const listener = vi.fn();
    const unsubscribe = subscribeToCoachReplyReady(listener);

    noteCoachReplyFinished(queryClient, 5);

    expect(getUnreadCoachReplyIds(queryClient)).toEqual([5]);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(5);
    unsubscribe();
  });

  it("marks and tells subscribers when the user is on a DIFFERENT conversation", () => {
    const { queryClient } = createQueryWrapper();
    const listener = vi.fn();
    const unsubscribe = subscribeToCoachReplyReady(listener);
    viewCoachConversation(queryClient, 8);

    noteCoachReplyFinished(queryClient, 5);

    expect(getUnreadCoachReplyIds(queryClient)).toEqual([5]);
    expect(listener).toHaveBeenCalledWith(5);
    unsubscribe();
  });

  it("tells subscribers about every reply it records but keeps a single mark", () => {
    const { queryClient } = createQueryWrapper();
    const listener = vi.fn();
    const unsubscribe = subscribeToCoachReplyReady(listener);

    noteCoachReplyFinished(queryClient, 5);
    noteCoachReplyFinished(queryClient, 5);

    expect(getUnreadCoachReplyIds(queryClient)).toEqual([5]);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("stops telling a subscriber once it unsubscribes", () => {
    const { queryClient } = createQueryWrapper();
    const listener = vi.fn();
    subscribeToCoachReplyReady(listener)();

    noteCoachReplyFinished(queryClient, 5);

    expect(listener).not.toHaveBeenCalled();
    // The mark is recorded whether or not anyone is listening for the toast.
    expect(getUnreadCoachReplyIds(queryClient)).toEqual([5]);
  });
});

describe("cache lifetime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // Neither entry has a long-lived useQuery observer in this test (the badge
  // observes one in the app, not the viewed marker), so a default 5-minute
  // gcTime would drop a mark on a timer rooted at its first write. Same shape
  // as the recipe-turn mark's survival test in useChat.test.ts.
  it("both entries survive past the default gcTime (5 min) with no observer mounted", () => {
    vi.useFakeTimers();
    const { queryClient } = createQueryWrapper();

    markCoachReplyUnread(queryClient, 5);
    viewCoachConversation(queryClient, 8);
    act(() => {
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    });

    expect(getUnreadCoachReplyIds(queryClient)).toEqual([5]);
    expect(getViewedCoachConversation(queryClient)).toBe(8);
  });
});

describe("useHasUnreadCoachReply", () => {
  // TanStack batches observer notifications onto a macrotask (notifyManager's
  // default scheduler is setTimeout 0), so a cache write reaches React one task
  // later. The app is unaffected; a test must wait for the flush before it can
  // assert on what the hook rendered — or on what it did NOT re-render.
  const flushNotifications = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

  it("is false with no marks, true while any mark exists, false once all clear", async () => {
    const { wrapper, queryClient } = createQueryWrapper();
    const { result } = renderHook(() => useHasUnreadCoachReply(), { wrapper });
    expect(result.current).toBe(false);

    act(() => {
      markCoachReplyUnread(queryClient, 5);
    });
    await waitFor(() => expect(result.current).toBe(true));

    act(() => {
      markCoachReplyUnread(queryClient, 8);
      clearCoachReplyUnread(queryClient, 5);
    });
    await flushNotifications();
    expect(result.current).toBe(true);

    act(() => {
      clearCoachReplyUnread(queryClient, 8);
    });
    await waitFor(() => expect(result.current).toBe(false));
  });

  it("re-renders only when the answer flips, not on every mark change", async () => {
    const { wrapper, queryClient } = createQueryWrapper();
    let renders = 0;
    const { result } = renderHook(
      () => {
        renders++;
        return useHasUnreadCoachReply();
      },
      { wrapper },
    );
    const afterMount = renders;

    act(() => {
      markCoachReplyUnread(queryClient, 5);
    });
    await waitFor(() => expect(result.current).toBe(true));
    const afterFirstMark = renders;
    act(() => {
      markCoachReplyUnread(queryClient, 8);
      markCoachReplyUnread(queryClient, 9);
    });
    await flushNotifications();

    expect(afterFirstMark).toBeGreaterThan(afterMount);
    // Two more marks, same answer: no further render.
    expect(renders).toBe(afterFirstMark);
  });

  // The app-wide default queryFn builds an API URL from the query key, and
  // cache invalidation helpers run over every key — this one is cache-only and
  // must never be fetched (skipToken), or the dot would flicker off on a
  // refresh-everything call.
  it("keeps its answer through an unfiltered invalidate, without fetching", async () => {
    const { wrapper, queryClient } = createQueryWrapper();
    const { result } = renderHook(() => useHasUnreadCoachReply(), { wrapper });
    act(() => {
      markCoachReplyUnread(queryClient, 5);
    });
    await waitFor(() => expect(result.current).toBe(true));

    await act(async () => {
      await queryClient.invalidateQueries();
      await queryClient.refetchQueries();
    });
    await flushNotifications();

    expect(result.current).toBe(true);
    expect(queryClient.isFetching()).toBe(0);
    expect(getUnreadCoachReplyIds(queryClient)).toEqual([5]);
  });
});
