// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent, act } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { REFRESH_ON_FOCUS_SETTLE_MS } from "@/hooks/useRefreshOnFocus";
import CoachProScreen from "../CoachProScreen";

const {
  mockAcknowledge,
  mockUsePremiumFeature,
  mockRefetchConversations,
  focusEffectCb,
  premiumContextState,
  conversationsState,
  mockCreateConversation,
  routeState,
  keyboardState,
  mockNavigate,
  briefState,
} = vi.hoisted(() => ({
  mockAcknowledge: vi.fn(),
  mockUsePremiumFeature: vi.fn(),
  // Hoisted so it stays referentially stable across renders, matching the
  // real useChatConversations().refetch (see the referential-equality-test-
  // mocks-must-match-hook-stability-profile solution doc).
  mockRefetchConversations: vi.fn(),
  // Captures the latest callback CoachProScreen's useRefreshOnFocus passes to
  // useFocusEffect, so tests can simulate a refocus by invoking it directly.
  focusEffectCb: { current: null as (() => void) | null },
  premiumContextState: { isPremiumResolved: true },
  // Mutable conversation list for useChatConversations — defaults to empty
  // (the original harness); the New-thread tests seed an existing thread.
  conversationsState: {
    data: [] as { id: number; title: string; isPinned: boolean }[],
  },
  mockCreateConversation: vi.fn(),
  routeState: { params: {} as { selectedConversationId?: number } },
  keyboardState: { visible: false },
  mockNavigate: vi.fn(),
  briefState: {
    hasPending: false,
    lastSeen: "2026-11-08" as string | null | undefined,
    markSeen: vi.fn(),
    useCoachBrief: vi.fn(),
  },
}));

const TODAY = "2026-11-08";
vi.mock(
  "@/components/coach/opening-brief-decision",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    localDateString: () => TODAY,
  }),
);

vi.mock("@/hooks/usePendingReminders", () => ({
  usePendingReminders: () => ({ hasPending: briefState.hasPending }),
}));

vi.mock("@/lib/coach-brief-seen", () => ({
  getCachedLastBriefSeenDate: () => briefState.lastSeen,
  markBriefSeen: briefState.markSeen,
}));

vi.mock("@/hooks/useCoachBrief", () => ({
  useCoachBrief: briefState.useCoachBrief,
}));

vi.mock("@/hooks/useKeyboardVisible", () => ({
  useKeyboardVisible: () => keyboardState.visible,
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mockNavigate, setParams: vi.fn() }),
  useRoute: () => ({ params: routeState.params }),
  useFocusEffect: (cb: () => void) => {
    focusEffectCb.current = cb;
  },
}));

// Non-zero so the input bar's tab-bar padding is distinguishable from its own.
vi.mock("@react-navigation/bottom-tabs", () => ({
  useBottomTabBarHeight: () => 83,
}));

vi.mock("@/context/PremiumContext", () => ({
  usePremiumContext: () => premiumContextState,
}));

vi.mock("@/hooks/usePremiumFeatures", () => ({
  usePremiumFeature: mockUsePremiumFeature,
}));

vi.mock("@/hooks/useChat", () => ({
  useCreateConversation: () => ({ mutateAsync: mockCreateConversation }),
  useChatConversations: () => ({
    data: conversationsState.data,
    isError: false,
    refetch: mockRefetchConversations,
  }),
}));

vi.mock("@/hooks/useNotebook", () => ({
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
    conversationId,
    onCreateConversation,
    inputBarStyle,
    openingBrief,
    onReminderHandled,
  }: {
    openingBrief?: { form: string; onShown?: () => void } | null;
    onReminderHandled?: () => void;
    onMessageSent?: () => void;
    isCoachPro?: boolean;
    conversationId?: number | null;
    onCreateConversation?: () => Promise<number>;
    inputBarStyle?: { paddingBottom?: number };
  }) => (
    <>
      <button onClick={() => onMessageSent?.()}>mock-send</button>
      <button onClick={() => void onCreateConversation?.()}>mock-create</button>
      <div>{`coach-pro:${String(isCoachPro)}`}</div>
      <div>{`conversation:${String(conversationId)}`}</div>
      <div>{`input-pad:${String(inputBarStyle?.paddingBottom)}`}</div>
      <div>{`brief:${openingBrief ? openingBrief.form : "none"}`}</div>
      <button onClick={() => openingBrief?.onShown?.()}>
        mock-brief-shown
      </button>
      <button onClick={() => onReminderHandled?.()}>
        mock-reminder-handled
      </button>
    </>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  focusEffectCb.current = null;
  mockAcknowledge.mockResolvedValue(undefined);
  // Defaults preserve the original harness: Coach Pro user, premium resolved.
  premiumContextState.isPremiumResolved = true;
  conversationsState.data = [];
  routeState.params = {};
  keyboardState.visible = false;
  mockUsePremiumFeature.mockReturnValue(true);
  briefState.hasPending = false;
  briefState.lastSeen = TODAY;
  briefState.useCoachBrief.mockReturnValue({
    brief: {
      greeting: "Good afternoon.",
      recap: "Nothing logged yet today.",
      stats: [],
      pointer: null,
      reminder: null,
      suggestions: [],
      text: "Good afternoon.\n\nNothing logged yet today.",
    },
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

describe("CoachProScreen — New thread", () => {
  const existingThread = { id: 7, title: "What should I eat", isPinned: false };

  it("opens the most recent thread on first load", () => {
    conversationsState.data = [existingThread];
    renderComponent(<CoachProScreen />);

    expect(screen.getByText("conversation:7")).toBeDefined();
  });

  it("tapping New leaves the previous thread and shows an empty draft", () => {
    conversationsState.data = [existingThread];
    renderComponent(<CoachProScreen />);
    expect(screen.getByText("conversation:7")).toBeDefined();

    fireEvent.click(screen.getByLabelText("Start a new coach conversation"));

    expect(screen.getByText("conversation:null")).toBeDefined();
    expect(
      screen
        .getByLabelText("Open coach conversation What should I eat")
        .getAttribute("aria-selected"),
    ).not.toBe("true");
  });

  it("tapping New before the thread list loads does not re-select a thread when it arrives", () => {
    const { rerender } = renderComponent(<CoachProScreen />);
    fireEvent.click(screen.getByLabelText("Start a new coach conversation"));

    conversationsState.data = [existingThread];
    rerender(<CoachProScreen />);

    expect(screen.getByText("conversation:null")).toBeDefined();
  });

  it("the draft becomes the new conversation once its first message creates it", async () => {
    conversationsState.data = [existingThread];
    mockCreateConversation.mockResolvedValue({ id: 42 });
    renderComponent(<CoachProScreen />);
    fireEvent.click(screen.getByLabelText("Start a new coach conversation"));

    fireEvent.click(screen.getByText("mock-create"));

    expect(await screen.findByText("conversation:42")).toBeDefined();
  });

  it("a thread picked from See all after New stays open, and New still empties it", () => {
    conversationsState.data = [existingThread];
    const { rerender } = renderComponent(<CoachProScreen />);
    fireEvent.click(screen.getByLabelText("Start a new coach conversation"));

    routeState.params = { selectedConversationId: 7 };
    rerender(<CoachProScreen />);
    expect(screen.getByText("conversation:7")).toBeDefined();

    routeState.params = {};
    rerender(<CoachProScreen />);
    fireEvent.click(screen.getByLabelText("Start a new coach conversation"));
    expect(screen.getByText("conversation:null")).toBeDefined();
  });

  it("picking an existing thread after New opens that thread", () => {
    conversationsState.data = [existingThread];
    renderComponent(<CoachProScreen />);
    fireEvent.click(screen.getByLabelText("Start a new coach conversation"));

    fireEvent.click(
      screen.getByLabelText("Open coach conversation What should I eat"),
    );

    expect(screen.getByText("conversation:7")).toBeDefined();
  });
});

describe("CoachProScreen — premium gate (coachPro)", () => {
  // The screen has no redirect/paywall (the navigator is the access gate);
  // its own gate behavior is downgrading CoachChat.
  it("free tier with premium resolved: downgrades CoachChat", () => {
    mockUsePremiumFeature.mockReturnValue(false);
    renderComponent(<CoachProScreen />);
    expect(mockUsePremiumFeature).toHaveBeenCalledWith("coachPro");
    expect(screen.getByText("coach-pro:false")).toBeTruthy();
  });

  it("Coach Pro user: passes isCoachPro (non-vacuity control)", () => {
    renderComponent(<CoachProScreen />);
    expect(screen.getByText("coach-pro:true")).toBeTruthy();
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

describe("CoachProScreen — typing makes room for the input", () => {
  it("keyboard down: the input clears the tab bar", () => {
    renderComponent(<CoachProScreen />);
    expect(screen.getByText("input-pad:83")).toBeTruthy();
  });

  it("keyboard up: the input drops the tab-bar padding", () => {
    keyboardState.visible = true;
    renderComponent(<CoachProScreen />);
    expect(screen.queryByText("input-pad:83")).toBeNull();
    expect(screen.getByText("input-pad:8")).toBeTruthy();
  });
});

describe("CoachProScreen — opening brief", () => {
  const thread = { id: 4, title: "Earlier", isPinned: false };

  it("has no dashboard; the Notebook sits in the thread bar", () => {
    renderComponent(<CoachProScreen />);
    expect(screen.queryByRole("button", { name: /dashboard/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Notebook" }));
    expect(mockNavigate).toHaveBeenCalledWith("NotebookScreen");
  });

  it("opens the last thread as before once today's brief was seen", () => {
    conversationsState.data = [thread];
    renderComponent(<CoachProScreen />);
    expect(screen.getByText("conversation:4")).toBeTruthy();
    expect(screen.getByText("brief:none")).toBeTruthy();
  });

  it("opens a fresh chat with the full brief on the first visit of the day", () => {
    conversationsState.data = [thread];
    briefState.lastSeen = "2026-11-07";
    renderComponent(<CoachProScreen />);
    expect(screen.getByText("conversation:null")).toBeTruthy();
    expect(screen.getByText("brief:full")).toBeTruthy();
    expect(briefState.useCoachBrief).toHaveBeenCalledWith("full", true);
  });

  it("opens a fresh chat with the full brief when a reminder is pending", () => {
    conversationsState.data = [thread];
    briefState.hasPending = true;
    renderComponent(<CoachProScreen />);
    expect(screen.getByText("conversation:null")).toBeTruthy();
    expect(screen.getByText("brief:full")).toBeTruthy();
  });

  it("a named conversation wins over the draft rule", () => {
    conversationsState.data = [thread];
    briefState.hasPending = true;
    routeState.params = { selectedConversationId: 4 };
    renderComponent(<CoachProScreen />);
    expect(screen.getByText("conversation:4")).toBeTruthy();
  });

  it("New after today's brief gives the short form", () => {
    conversationsState.data = [thread];
    renderComponent(<CoachProScreen />);
    fireEvent.click(
      screen.getByRole("button", { name: "Start a new coach conversation" }),
    );
    expect(screen.getByText("brief:short")).toBeTruthy();
  });

  it("marks today seen when the full brief shows, and keeps that draft's form", () => {
    briefState.lastSeen = null;
    renderComponent(<CoachProScreen />);
    fireEvent.click(screen.getByText("mock-brief-shown"));
    expect(briefState.markSeen).toHaveBeenCalledWith(TODAY);
    briefState.lastSeen = TODAY;
    fireEvent.click(screen.getByText("mock-send"));
    expect(screen.getByText("brief:full")).toBeTruthy();
  });

  it("clears reminders when the brief's reminder is handled without a send", () => {
    briefState.hasPending = true;
    renderComponent(<CoachProScreen />);
    fireEvent.click(screen.getByText("mock-reminder-handled"));
    expect(mockAcknowledge).toHaveBeenCalledTimes(1);
  });

  it("keeps the brief on screen while the first send creates the conversation", async () => {
    briefState.hasPending = true;
    mockCreateConversation.mockResolvedValue({ id: 55 });
    renderComponent(<CoachProScreen />);
    await act(async () => {
      fireEvent.click(screen.getByText("mock-create"));
    });
    expect(screen.getByText("conversation:55")).toBeTruthy();
    expect(screen.getByText("brief:full")).toBeTruthy();
  });

  it("shows no brief in a thread picked afterwards", async () => {
    conversationsState.data = [thread];
    briefState.hasPending = true;
    mockCreateConversation.mockResolvedValue({ id: 55 });
    renderComponent(<CoachProScreen />);
    await act(async () => {
      fireEvent.click(screen.getByText("mock-create"));
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Open coach conversation Earlier" }),
    );
    expect(screen.getByText("conversation:4")).toBeTruthy();
    expect(screen.getByText("brief:none")).toBeTruthy();
  });

  it("asks for no brief while a thread is open", () => {
    conversationsState.data = [thread];
    renderComponent(<CoachProScreen />);
    expect(briefState.useCoachBrief).toHaveBeenLastCalledWith("short", false);
  });
});
