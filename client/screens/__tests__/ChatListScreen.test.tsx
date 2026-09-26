// @vitest-environment jsdom
/**
 * Regression test for P3-2026-09-24-mounted-chat-list-stays-stale-after-abort:
 * a conversation whose reply finished after the user left is marked stale
 * with `refetchType: "none"` (#1060/#1065), which only refetches once a query
 * observer mounts. ChatListScreen stays mounted across a stack push/pop, so
 * it needs its own focus-driven refetch to pick that reply up.
 */
import React from "react";
import { act, screen } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import ChatListScreen from "../ChatListScreen";
import { REFRESH_ON_FOCUS_SETTLE_MS } from "@/hooks/useRefreshOnFocus";

const { mockRefetch, focusEffectCb, refreshControlProps, conversations } =
  vi.hoisted(() => ({
    // Lets a test's mocked refetch() change what useChatConversations returns
    // (and re-render the screen), the way a real refetch writes new data into
    // the query cache. `setData` is captured from the mock hook's own useState.
    conversations: {
      setData: null as null | ((data: unknown[]) => void),
    },
    // Hoisted so it stays referentially stable across renders, matching the
    // real useChatConversations().refetch (see the referential-equality-test-
    // mocks-must-match-hook-stability-profile solution doc).
    mockRefetch: vi.fn(),
    // Captures the latest callback ChatListScreen's useRefreshOnFocus passes to
    // useFocusEffect, so tests can simulate a refocus by invoking it directly.
    focusEffectCb: { current: null as (() => void) | null },
    // Captures the props ChatListScreen's <RefreshControl> was last rendered
    // with, so a test can assert `refreshing` stays false for a background
    // focus-triggered refetch and only flips true for a user-initiated pull.
    refreshControlProps: {
      current: null as null | {
        refreshing?: boolean;
        onRefresh?: () => void | Promise<void>;
      },
    },
  }));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: vi.fn() }),
  useFocusEffect: (cb: () => void) => {
    focusEffectCb.current = cb;
  },
}));

// The shared FlatList mock (test/mocks/react-native.ts) only destructures
// data/renderItem/keyExtractor/ListEmptyComponent/ListHeaderComponent/
// ListFooterComponent/testID — it never reads or renders `refreshControl`,
// so a <RefreshControl> passed via that prop is constructed but never
// reconciled and its own mock component never executes (see
// docs/solutions/conventions/refresh-control-onrefresh-unreachable-under-
// scrollview-mock-2026-09-25.md — same root cause there, for ScrollView).
// Locally override both FlatList and RefreshControl to make it reachable;
// every other export passes through to the real mock file unchanged.
vi.mock("react-native", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-native")>();
  const RefreshControl = (props: {
    refreshing?: boolean;
    onRefresh?: () => void | Promise<void>;
  }) => {
    refreshControlProps.current = props;
    return null;
  };
  const FlatList = ({
    refreshControl,
    ...rest
  }: { refreshControl?: React.ReactNode } & Record<string, unknown>) =>
    React.createElement(
      React.Fragment,
      null,
      refreshControl,
      React.createElement(
        actual.FlatList as unknown as React.ComponentType<
          Record<string, unknown>
        >,
        rest,
      ),
    );
  FlatList.displayName = "FlatList";
  return { ...actual, RefreshControl, FlatList };
});

vi.mock("@react-navigation/bottom-tabs", () => ({
  useBottomTabBarHeight: () => 0,
}));

vi.mock("@/hooks/useChat", () => ({
  useChatConversations: () => {
    const [data, setData] = React.useState<unknown[]>([]);
    conversations.setData = setData;
    return {
      data,
      isLoading: false,
      refetch: mockRefetch,
      isRefetching: false,
    };
  },
  useCreateConversation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteConversation: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: vi.fn(),
    notification: vi.fn(),
    selection: vi.fn(),
    disabled: false,
  }),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock("@/hooks/useAccessibility", () => ({
  useAccessibility: () => ({ reducedMotion: false }),
}));

vi.mock("@/components/ConfirmationModal", () => ({
  useConfirmationModal: () => ({
    confirm: vi.fn(),
    ConfirmationModal: () => null,
    behindContentA11yProps: {},
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  focusEffectCb.current = null;
  refreshControlProps.current = null;
  conversations.setData = null;
});

describe("ChatListScreen — refetch on refocus", () => {
  it("does not refetch on the initial focus (already fresh from useQuery)", () => {
    renderComponent(<ChatListScreen />);

    expect(focusEffectCb.current).toBeTypeOf("function");
    focusEffectCb.current?.();

    expect(mockRefetch).not.toHaveBeenCalled();
  });

  it("refetches the conversation list when the screen regains focus", () => {
    renderComponent(<ChatListScreen />);

    focusEffectCb.current?.(); // initial focus (mount) — skipped
    focusEffectCb.current?.(); // returning focus — triggers a refetch

    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it("still renders the empty state after a refocus-triggered refetch", () => {
    // Non-vacuity control: the screen doesn't crash or blank out once the
    // focus effect wires up.
    renderComponent(<ChatListScreen />);
    focusEffectCb.current?.();
    focusEffectCb.current?.();

    expect(screen.getByText("Start a Conversation")).toBeTruthy();
  });

  it("does not flash the pull-to-refresh spinner for a background focus-triggered refetch", () => {
    renderComponent(<ChatListScreen />);

    expect(refreshControlProps.current?.refreshing).toBe(false);

    focusEffectCb.current?.(); // initial focus (mount) — skipped
    focusEffectCb.current?.(); // returning focus — triggers a background refetch

    expect(mockRefetch).toHaveBeenCalledTimes(1);
    // The background refetch must not flip the pull-to-refresh spinner — only
    // a user-initiated pull (via RefreshControl's own onRefresh) should.
    expect(refreshControlProps.current?.refreshing).toBe(false);
  });

  it("shows the pull-to-refresh spinner only for a user-initiated pull", async () => {
    renderComponent(<ChatListScreen />);

    let resolveRefetch: (() => void) | undefined;
    mockRefetch.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveRefetch = resolve;
        }),
    );

    let onRefreshPromise: void | Promise<void> | undefined;
    act(() => {
      onRefreshPromise = refreshControlProps.current?.onRefresh?.();
    });
    expect(refreshControlProps.current?.refreshing).toBe(true);

    await act(async () => {
      resolveRefetch?.();
      await onRefreshPromise;
    });
    expect(refreshControlProps.current?.refreshing).toBe(false);
  });
});

describe("ChatListScreen — refocus in the same transition as an abort", () => {
  // The refocus usually lands in the SAME transition as the abort that marked
  // the list stale with `refetchType: "none"` — i.e. before the server's
  // post-disconnect settle (partial-reply persist / refund) has written. The
  // immediate refetch therefore returns pre-settle data; without a follow-up
  // the list would keep showing it for the whole 5-min staleTime.
  afterEach(() => {
    vi.useRealTimers();
  });

  const conv = (title: string) => ({
    id: 1,
    userId: "u1",
    title,
    type: "coach",
    isPinned: false,
    pinnedAt: null,
    createdAt: "2026-09-25T10:00:00.000Z",
    updatedAt: "2026-09-25T10:00:00.000Z",
  });

  it("ends up showing the settled list, not the pre-settle one the immediate refetch returned", async () => {
    vi.useFakeTimers();
    mockRefetch
      .mockImplementationOnce(() => {
        conversations.setData?.([conv("Pre-settle title")]);
        return Promise.resolve();
      })
      .mockImplementationOnce(() => {
        conversations.setData?.([conv("Settled title")]);
        return Promise.resolve();
      });

    renderComponent(<ChatListScreen />);
    act(() => {
      focusEffectCb.current?.(); // initial focus (mount) — skipped
    });
    act(() => {
      focusEffectCb.current?.(); // refocus, same transition as the abort
    });
    expect(screen.getByText("Pre-settle title")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_ON_FOCUS_SETTLE_MS);
    });

    expect(mockRefetch).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Settled title")).toBeTruthy();
    expect(screen.queryByText("Pre-settle title")).toBeNull();
  });
});
