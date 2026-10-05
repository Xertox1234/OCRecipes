// @vitest-environment jsdom
import React from "react";
import { act, screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import AllConversationsScreen from "../AllConversationsScreen";
import { REFRESH_ON_FOCUS_SETTLE_MS } from "@/hooks/useRefreshOnFocus";

const {
  mockGoBack,
  mockCanGoBack,
  mockNavigate,
  mockReset,
  mockUseChatConversations,
  mockRefetch,
  focusEffectCb,
  premiumState,
} = vi.hoisted(() => ({
  premiumState: { coachPro: true, isLoading: false },
  mockGoBack: vi.fn(),
  mockCanGoBack: vi.fn(),
  mockNavigate: vi.fn(),
  mockReset: vi.fn(),
  mockUseChatConversations: vi.fn(),
  // Hoisted so it stays referentially stable across renders, matching the
  // real useChatConversations().refetch (see the referential-equality-test-
  // mocks-must-match-hook-stability-profile solution doc).
  mockRefetch: vi.fn(),
  // Captures the latest callback AllConversationsScreen's useRefreshOnFocus
  // passes to useFocusEffect, so a test can simulate a refocus directly.
  focusEffectCb: { current: null as (() => void) | null },
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    goBack: mockGoBack,
    canGoBack: mockCanGoBack,
    navigate: mockNavigate,
    reset: mockReset,
  }),
  useFocusEffect: (cb: () => void) => {
    focusEffectCb.current = cb;
  },
}));

vi.mock("@/hooks/useChat", () => ({
  useChatConversations: (...args: unknown[]) =>
    mockUseChatConversations(...args),
  usePinConversation: () => ({ mutateAsync: vi.fn() }),
  useDeleteConversation: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/hooks/usePremiumFeatures", () => ({
  usePremiumFeature: () => premiumState.coachPro,
}));

vi.mock("@/context/PremiumContext", () => ({
  usePremiumContext: () => ({ isLoading: premiumState.isLoading }),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockCanGoBack.mockReturnValue(true);
  focusEffectCb.current = null;
  premiumState.coachPro = true;
  premiumState.isLoading = false;
  mockUseChatConversations.mockReturnValue({
    data: [],
    isLoading: false,
    refetch: mockRefetch,
  });
});

describe("AllConversationsScreen — safe back navigation", () => {
  // A cold-start deep link to conversation-list can land this screen as the
  // stack's sole entry — goBack() would be a silent no-op.
  it("goes back normally when a back stack exists", () => {
    mockCanGoBack.mockReturnValue(true);

    renderComponent(<AllConversationsScreen />);
    fireEvent.click(screen.getByLabelText("Close"));

    expect(mockGoBack).toHaveBeenCalledOnce();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("falls back to the Coach tab when there is no back stack", () => {
    mockCanGoBack.mockReturnValue(false);

    renderComponent(<AllConversationsScreen />);
    fireEvent.click(screen.getByLabelText("Close"));

    expect(mockGoBack).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockReset).toHaveBeenCalledWith({
      index: 0,
      routes: [{ name: "Main", params: { screen: "CoachTab" } }],
    });
  });
});

describe("AllConversationsScreen — Coach and Recipes tabs", () => {
  const conv = (id: number, title: string) => ({
    id,
    title,
    isPinned: false,
    updatedAt: new Date().toISOString(),
  });

  it("shows a Coach / Recipes tab list with Coach selected", () => {
    renderComponent(<AllConversationsScreen />);

    const coachTab = screen.getByLabelText("Coach chats");
    const recipeTab = screen.getByLabelText("Recipe chats");
    expect(coachTab.getAttribute("aria-selected")).toBe("true");
    expect(recipeTab.getAttribute("aria-selected")).toBe("false");
    expect(mockUseChatConversations).toHaveBeenLastCalledWith("coach", {
      search: undefined,
    });
  });

  it("a coach row opens Coach Pro on that conversation", () => {
    mockUseChatConversations.mockReturnValue({
      data: [conv(7, "Protein ideas")],
      isLoading: false,
    });

    renderComponent(<AllConversationsScreen />);
    fireEvent.click(screen.getByLabelText("Open conversation: Protein ideas"));

    // AllConversations is a ROOT-stack screen and CoachPro lives only in the
    // Coach tab's nested ChatStack, so a bare navigate("CoachPro") is never
    // handled (navigationInChildEnabled is off) and the tap did nothing. It
    // must name the path: Main → CoachTab → CoachPro. And it must pop back
    // to the existing Main: without `pop: true` the root StackRouter pushes
    // a second Main above this modal (measured against
    // @react-navigation/routers 7.5.2: routes [Main, AllConversations, Main]).
    expect(mockNavigate).toHaveBeenCalledWith(
      "Main",
      {
        screen: "CoachTab",
        params: { screen: "CoachPro", params: { selectedConversationId: 7 } },
      },
      { pop: true },
    );
    expect(mockNavigate).not.toHaveBeenCalledWith(
      "CoachPro",
      expect.anything(),
    );
  });

  it("a free-tier user's coach row opens the plain Chat screen", () => {
    premiumState.coachPro = false;
    mockUseChatConversations.mockReturnValue({
      data: [conv(9, "Free chat")],
      isLoading: false,
    });

    renderComponent(<AllConversationsScreen />);
    fireEvent.click(screen.getByLabelText("Open conversation: Free chat"));

    expect(mockNavigate).toHaveBeenCalledWith(
      "Main",
      {
        screen: "CoachTab",
        params: { screen: "Chat", params: { conversationId: 9 }, pop: true },
      },
      { pop: true },
    );
  });

  it("while premium status is loading, a coach row still opens Coach Pro", () => {
    premiumState.coachPro = false;
    premiumState.isLoading = true;
    mockUseChatConversations.mockReturnValue({
      data: [conv(10, "Loading chat")],
      isLoading: false,
    });

    renderComponent(<AllConversationsScreen />);
    fireEvent.click(screen.getByLabelText("Open conversation: Loading chat"));

    expect(mockNavigate).toHaveBeenCalledWith(
      "Main",
      {
        screen: "CoachTab",
        params: {
          screen: "CoachPro",
          params: { selectedConversationId: 10 },
        },
      },
      { pop: true },
    );
  });

  it("the Recipes tab lists recipe chats, and a row reopens that recipe chat", () => {
    mockUseChatConversations.mockImplementation((type: string) => ({
      data: type === "recipe" ? [conv(42, "Vegan tacos")] : [],
      isLoading: false,
    }));

    renderComponent(<AllConversationsScreen />);
    fireEvent.click(screen.getByLabelText("Recipe chats"));

    expect(
      screen.getByLabelText("Recipe chats").getAttribute("aria-selected"),
    ).toBe("true");
    expect(mockUseChatConversations).toHaveBeenLastCalledWith("recipe", {
      search: undefined,
    });
    fireEvent.click(screen.getByLabelText("Open conversation: Vegan tacos"));
    expect(mockNavigate).toHaveBeenCalledWith("RecipeChat", {
      conversationId: 42,
    });
  });

  it("an untitled recipe chat reads as a recipe chat", () => {
    mockUseChatConversations.mockImplementation((type: string) => ({
      data: type === "recipe" ? [conv(43, "")] : [],
      isLoading: false,
    }));

    renderComponent(<AllConversationsScreen />);
    fireEvent.click(screen.getByLabelText("Recipe chats"));

    expect(screen.getByText("Recipe chat")).toBeTruthy();
  });
});

describe("AllConversationsScreen — refetch on refocus (P3-2026-09-26)", () => {
  // Regression test for P3-2026-09-26-all-conversations-screen-no-refetch-
  // when-mounted: this screen can stay mounted under a pushed chat screen.
  // A reply that finishes after the user left marks the conversation list
  // stale with `refetchType: "none"` (#1060/#1065), which only refetches
  // once a query observer mounts — the same staleness shape #1096 fixed for
  // ChatListScreen/CoachProScreen (docs/solutions/logic-errors/focus-refetch-
  // races-refetchtype-none-invalidation-2026-09-25.md).
  afterEach(() => {
    vi.useRealTimers();
  });

  const conv = (title: string) => ({
    id: 1,
    title,
    isPinned: false,
    updatedAt: new Date().toISOString(),
  });

  it("does not refetch on the initial focus (already fresh from useQuery)", () => {
    renderComponent(<AllConversationsScreen />);

    expect(focusEffectCb.current).toBeTypeOf("function");
    focusEffectCb.current?.();

    expect(mockRefetch).not.toHaveBeenCalled();
  });

  it("refetches the conversation list when the screen regains focus", () => {
    renderComponent(<AllConversationsScreen />);

    focusEffectCb.current?.(); // initial focus (mount) — skipped
    focusEffectCb.current?.(); // returning focus — triggers a refetch

    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it("ends up showing the settled list, not the pre-settle one the immediate refetch returned", async () => {
    vi.useFakeTimers();
    let setData: ((data: unknown[]) => void) | null = null;
    mockUseChatConversations.mockImplementation(() => {
      const [data, setter] = React.useState<unknown[]>([]);
      setData = setter;
      return { data, isLoading: false, refetch: mockRefetch };
    });
    mockRefetch
      .mockImplementationOnce(() => {
        setData?.([conv("Pre-settle title")]);
        return Promise.resolve();
      })
      .mockImplementationOnce(() => {
        setData?.([conv("Settled title")]);
        return Promise.resolve();
      });

    renderComponent(<AllConversationsScreen />);
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
