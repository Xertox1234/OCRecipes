// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import * as RN from "react-native";
import { renderComponent } from "../../../test/utils/render-component";
import { REFRESH_ON_FOCUS_SETTLE_MS } from "@/hooks/useRefreshOnFocus";
import CoachProScreen from "../CoachProScreen";

const {
  mockAcknowledge,
  mockUsePremiumFeature,
  mockUseCoachContext,
  mockRefetchConversations,
  focusEffectCb,
  premiumContextState,
} = vi.hoisted(() => ({
  mockAcknowledge: vi.fn(),
  mockUsePremiumFeature: vi.fn(),
  mockUseCoachContext: vi.fn(),
  // Hoisted so it stays referentially stable across renders, matching the
  // real useChatConversations().refetch (see the referential-equality-test-
  // mocks-must-match-hook-stability-profile solution doc).
  mockRefetchConversations: vi.fn(),
  // Captures the latest callback CoachProScreen's useRefreshOnFocus passes to
  // useFocusEffect, so tests can simulate a refocus by invoking it directly.
  focusEffectCb: { current: null as (() => void) | null },
  premiumContextState: { isLoading: false },
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: vi.fn(), setParams: vi.fn() }),
  useRoute: () => ({ params: {} }),
  useFocusEffect: (cb: () => void) => {
    focusEffectCb.current = cb;
  },
}));

vi.mock("@react-navigation/bottom-tabs", () => ({
  useBottomTabBarHeight: () => 0,
}));

vi.mock("@/context/PremiumContext", () => ({
  usePremiumContext: () => premiumContextState,
}));

vi.mock("@/hooks/usePremiumFeatures", () => ({
  usePremiumFeature: mockUsePremiumFeature,
}));

vi.mock("@/hooks/useCoachContext", () => ({
  useCoachContext: mockUseCoachContext,
}));

vi.mock("@/hooks/useChat", () => ({
  useCreateConversation: () => ({ mutateAsync: vi.fn() }),
  useChatConversations: () => ({
    data: [],
    isError: false,
    refetch: mockRefetchConversations,
  }),
  useNotebookEntries: () => ({ data: [], isLoading: false }),
}));

vi.mock("@/hooks/useNotebookNotifications", () => ({
  useNotebookNotifications: () => ({
    cancelStaleReminders: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@/hooks/useCoachWarmUp", () => ({
  useCoachWarmUp: () => ({
    sendWarmUp: vi.fn(),
    sendTextWarmUp: vi.fn(),
    getWarmUpId: () => null,
    reset: vi.fn(),
  }),
}));

vi.mock("@/hooks/useAcknowledgeReminders", () => ({
  useAcknowledgeReminders: () => ({ acknowledge: mockAcknowledge }),
}));

// Thin CoachChat double — isolates CoachProScreen's onMessageSent wiring from
// CoachChat's own internals (already covered by CoachChat.test.tsx). Renders
// the isCoachPro prop so the gate tests can observe the downgrade plumbing.
vi.mock("@/components/coach/CoachChat", () => ({
  default: ({
    onMessageSent,
    isCoachPro,
  }: {
    onMessageSent?: () => void;
    isCoachPro?: boolean;
  }) => (
    <>
      <button onClick={() => onMessageSent?.()}>mock-send</button>
      <div>{`coach-pro:${String(isCoachPro)}`}</div>
    </>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  focusEffectCb.current = null;
  mockAcknowledge.mockResolvedValue(undefined);
  // Defaults preserve the original harness: Coach Pro user, premium resolved.
  premiumContextState.isLoading = false;
  mockUsePremiumFeature.mockReturnValue(true);
  mockUseCoachContext.mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
});

describe("CoachProScreen — reminder acknowledgment", () => {
  it("does not acknowledge reminders on mount", () => {
    renderComponent(<CoachProScreen />);
    expect(mockAcknowledge).not.toHaveBeenCalled();
  });

  it("acknowledges reminders once a message is sent", () => {
    renderComponent(<CoachProScreen />);
    fireEvent.click(screen.getByText("mock-send"));

    expect(mockAcknowledge).toHaveBeenCalledOnce();
  });

  it("does not acknowledge again on a second send in the same session", () => {
    renderComponent(<CoachProScreen />);
    const sendButton = screen.getByText("mock-send");

    fireEvent.click(sendButton);
    fireEvent.click(sendButton);

    expect(mockAcknowledge).toHaveBeenCalledOnce();
  });
});

describe("CoachProScreen — premium gate (coachPro)", () => {
  // The screen has no redirect/paywall (the navigator is the access gate);
  // its own gate behavior is (a) disabling the premium /api/coach/context
  // fetch for confirmed-free users and (b) downgrading CoachChat.
  it("free tier with premium resolved: disables the coach-context fetch and downgrades CoachChat", () => {
    mockUsePremiumFeature.mockReturnValue(false);

    renderComponent(<CoachProScreen />);

    expect(mockUsePremiumFeature).toHaveBeenCalledWith("coachPro");
    expect(mockUseCoachContext).toHaveBeenCalledWith(false);
    expect(screen.getByText("coach-pro:false")).toBeTruthy();
  });

  it("Coach Pro user: enables the coach-context fetch and passes isCoachPro (non-vacuity control)", () => {
    renderComponent(<CoachProScreen />);

    expect(mockUseCoachContext).toHaveBeenCalledWith(true);
    expect(screen.getByText("coach-pro:true")).toBeTruthy();
  });

  it("keeps the context fetch enabled while premium status is still loading", () => {
    // contextEnabled = isCoachPro || isPremiumLoading — the screen is only
    // mounted for Pro users, so it assumes access until premium resolves
    // rather than flashing a disabled fetch.
    mockUsePremiumFeature.mockReturnValue(false);
    premiumContextState.isLoading = true;

    renderComponent(<CoachProScreen />);

    expect(mockUseCoachContext).toHaveBeenCalledWith(true);
  });
});

describe("CoachProScreen — thread bar refetch on refocus", () => {
  // The thread bar (coachConversations) stays mounted across a tab
  // blur/refocus — a conversation whose reply finished after the user left
  // is marked stale (`refetchType: "none"`, #1060) and only shows up here
  // once this observer refetches. See P3-2026-09-24-mounted-chat-list-stays-
  // stale-after-abort.
  it("does not refetch on the initial focus, then refetches on a later one", () => {
    renderComponent(<CoachProScreen />);

    expect(focusEffectCb.current).toBeTypeOf("function");
    focusEffectCb.current?.(); // initial focus (mount) — skipped
    expect(mockRefetchConversations).not.toHaveBeenCalled();

    focusEffectCb.current?.(); // returning focus — triggers a refetch
    expect(mockRefetchConversations).toHaveBeenCalledTimes(1);
  });
  it("re-reads once more after the settle margin (opts in to the follow-up)", () => {
    // The refocus usually lands in the same transition as the Ask Coach
    // overlay's `refetchType: "none"` dismissal — before the server settles.
    vi.useFakeTimers();
    try {
      renderComponent(<CoachProScreen />);
      focusEffectCb.current?.(); // initial focus (mount) — skipped
      focusEffectCb.current?.(); // returning focus
      expect(mockRefetchConversations).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(REFRESH_ON_FOCUS_SETTLE_MS);
      expect(mockRefetchConversations).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

// P2-2026-09-23 (M15): the loading skeleton must be one hidden region (both
// platforms) with a delayed announce, not a container whose own
// accessibilityLabel is hidden along with the decorative boxes. Fake timers
// scoped to this describe only, mirroring NutritionDetailScreen.test.tsx's
// loading-branch characterisation.
describe("CoachProScreen — loading skeleton screen-reader signal", () => {
  beforeEach(() => {
    mockUseCoachContext.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("hides the skeleton region from screen readers as one unit", () => {
    renderComponent(<CoachProScreen />);
    const region = screen.getByTestId("coach-pro-loading-skeleton");
    expect(region.getAttribute("aria-hidden")).toBe("true");
  });

  // Fails on main: today the region itself carries `accessibilityLabel=
  // "Loading..."` alongside `accessibilityElementsHidden`, which hides the
  // label along with the decorative boxes on iOS.
  it("does not carry its own hidden Loading label", () => {
    renderComponent(<CoachProScreen />);
    expect(screen.queryByLabelText("Loading...")).toBeNull();
  });

  it("does not announce Loading synchronously, then announces it once after the delay", () => {
    const announceSpy = vi.spyOn(
      RN.AccessibilityInfo,
      "announceForAccessibility",
    );
    try {
      renderComponent(<CoachProScreen />);

      expect(announceSpy).not.toHaveBeenCalledWith("Loading");

      vi.advanceTimersByTime(500);

      expect(announceSpy).toHaveBeenCalledExactlyOnceWith("Loading");
    } finally {
      announceSpy.mockRestore();
    }
  });

  it("cancels the pending Loading announce if the screen unmounts before the delay elapses", () => {
    const announceSpy = vi.spyOn(
      RN.AccessibilityInfo,
      "announceForAccessibility",
    );
    try {
      const { unmount } = renderComponent(<CoachProScreen />);
      unmount();
      vi.advanceTimersByTime(500);

      expect(announceSpy).not.toHaveBeenCalledWith("Loading");
    } finally {
      announceSpy.mockRestore();
    }
  });
});
