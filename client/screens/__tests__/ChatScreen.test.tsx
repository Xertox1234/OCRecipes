// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent, render, waitFor } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";
import {
  getUnreadCoachReplyIds,
  getViewedCoachConversation,
  markCoachReplyUnread,
  noteCoachReplyFinished,
} from "@/hooks/useCoachUnreadReplies";
import ChatScreen from "../ChatScreen";

const {
  mockSendMessage,
  mockUseSendMessage,
  focusState,
  mockAcknowledge,
  mockCreateMutateAsync,
  mockSetParams,
  mockGoBack,
  mockPopTo,
  mockCanGoBack,
  mockRouteParams,
  mockUseChatMessages,
  mockSendMessageState,
  mockToastError,
  mockToastSuccess,
  mockToastInfo,
} = vi.hoisted(() => ({
  mockGoBack: vi.fn(),
  mockPopTo: vi.fn(),
  mockCanGoBack: vi.fn(() => false),
  mockSendMessage: vi.fn(),
  // Records the arguments ChatScreen passes to useSendMessage.
  mockUseSendMessage: vi.fn(),
  // Stands in for the navigator's focus: useFocusEffect below only runs its
  // effect while this is true, and runs the cleanup when it flips to false.
  focusState: { focused: true },
  mockAcknowledge: vi.fn(),
  mockCreateMutateAsync: vi.fn(),
  mockSetParams: vi.fn(),
  // A mutable ref (not a static factory return) so each test can simulate a
  // different deep-link/navigation route.params shape. Typed looser than
  // ChatStackParamList's `Chat` union on purpose: an unparsed query param
  // (e.g. `chat/abc?initialMessage=hi`) lands both keys in route.params at
  // once at runtime (see linking.ts's Scan/verifyBarcode comment), which the
  // production union type doesn't model.
  mockRouteParams: {
    value: { conversationId: 42 } as
      | { conversationId?: number; initialMessage?: string }
      | undefined,
  },
  mockUseChatMessages: vi.fn(),
  // A mutable ref so tests can simulate useSendMessage's streaming/error
  // state changing across a rerender (e.g. a stream starting then ending).
  mockSendMessageState: {
    value: {
      streamingContent: "",
      isStreaming: false,
      streamError: null as boolean | null,
      requestError: null as string | null,
    },
  },
  mockToastError: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastInfo: vi.fn(),
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    setParams: mockSetParams,
    goBack: mockGoBack,
    popTo: mockPopTo,
    canGoBack: mockCanGoBack,
  }),
  useRoute: () => ({ params: mockRouteParams.value }),
  // Mirrors the real hook's contract (core's useFocusEffect): run the effect
  // while the screen is focused, run its cleanup on blur AND on unmount, and
  // re-run when the callback's identity changes. The real one needs a
  // NavigationContainer; `focusState` plays the navigator.
  useFocusEffect: (effect: () => void | (() => void)) => {
    const focused = focusState.focused;
    React.useEffect(() => (focused ? effect() : undefined), [effect, focused]);
  },
}));

vi.mock("@/hooks/useChat", () => ({
  useChatMessages: (conversationId: number | null) =>
    mockUseChatMessages(conversationId),
  useSendMessage: (...args: unknown[]) => {
    mockUseSendMessage(...args);
    return {
      sendMessage: mockSendMessage,
      ...mockSendMessageState.value,
    };
  },
  useCreateConversation: () => ({ mutateAsync: mockCreateMutateAsync }),
}));

const { mockImpact } = vi.hoisted(() => ({ mockImpact: vi.fn() }));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: mockImpact,
    notification: vi.fn(),
    selection: vi.fn(),
  }),
}));

vi.mock("@/hooks/useAcknowledgeReminders", () => ({
  useAcknowledgeReminders: () => ({ acknowledge: mockAcknowledge }),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({
    success: mockToastSuccess,
    error: mockToastError,
    info: mockToastInfo,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  focusState.focused = true;
  mockRouteParams.value = { conversationId: 42 };
  mockSendMessage.mockResolvedValue(undefined);
  mockAcknowledge.mockResolvedValue(undefined);
  mockUseChatMessages.mockReturnValue({ data: [], isLoading: false });
  mockSendMessageState.value = {
    streamingContent: "",
    isStreaming: false,
    streamError: null,
    requestError: null,
  };
});

describe("ChatScreen — the message you just sent", () => {
  const userMessage = (id: number, content: string) => ({
    id,
    conversationId: 42,
    role: "user",
    content,
    metadata: null,
    createdAt: new Date().toISOString(),
  });

  function typeAndSend(text: string) {
    fireEvent.change(screen.getByPlaceholderText("Ask NutriCoach..."), {
      target: { value: text },
    });
    fireEvent.click(screen.getByLabelText("Send message"));
  }

  // The messages query isn't refetched until the reply finishes, so without
  // a local copy the sent text vanished from the input and showed nowhere.
  it("shows it while the reply is on its way", () => {
    mockSendMessage.mockReturnValue(new Promise(() => {}));
    renderComponent(<ChatScreen />);

    typeAndSend("How much protein today?");

    expect(screen.getByText("How much protein today?")).toBeTruthy();
  });

  it("shows it once after the saved message arrives", () => {
    mockSendMessage.mockReturnValue(new Promise(() => {}));
    const { rerender } = renderComponent(<ChatScreen />);
    typeAndSend("How much protein today?");

    mockUseChatMessages.mockReturnValue({
      data: [userMessage(1, "How much protein today?")],
      isLoading: false,
    });
    rerender(<ChatScreen />);

    expect(screen.getAllByText("How much protein today?")).toHaveLength(1);
  });

  // Keyed on the saved message count, not on matching text: repeating an
  // earlier question still shows the new copy straight away.
  it("shows a repeat of an earlier message too", () => {
    mockSendMessage.mockReturnValue(new Promise(() => {}));
    mockUseChatMessages.mockReturnValue({
      data: [userMessage(1, "Thanks")],
      isLoading: false,
    });
    renderComponent(<ChatScreen />);

    typeAndSend("Thanks");

    expect(screen.getAllByText("Thanks")).toHaveLength(2);
  });

  // sendMessage reports a failed request through requestError rather than
  // rejecting, and no refetch follows, so the local copy must go here too.
  it("drops it and gives the draft back when the request fails", () => {
    const { rerender } = renderComponent(<ChatScreen />);
    typeAndSend("How much protein today?");
    expect(screen.getByText("How much protein today?")).toBeTruthy();

    mockSendMessageState.value = {
      ...mockSendMessageState.value,
      requestError: "Too many requests",
    };
    rerender(<ChatScreen />);

    expect(screen.queryByText("How much protein today?")).toBeNull();
    expect(
      (screen.getByPlaceholderText("Ask NutriCoach...") as HTMLInputElement)
        .value,
    ).toBe("How much protein today?");
  });

  it("drops it and gives the draft back when starting the chat fails", async () => {
    mockRouteParams.value = {};
    mockCreateMutateAsync.mockRejectedValue(new Error("network down"));
    renderComponent(<ChatScreen />);

    typeAndSend("How much protein today?");

    await waitFor(() =>
      expect(screen.queryByText("How much protein today?")).toBeNull(),
    );
    expect(
      (screen.getByPlaceholderText("Ask NutriCoach...") as HTMLInputElement)
        .value,
    ).toBe("How much protein today?");
  });
});

describe("ChatScreen — send haptic", () => {
  // Positive control for the prompt case: a typed send buzzes once.
  it("buzzes once for a typed send", () => {
    renderComponent(<ChatScreen />);
    fireEvent.change(screen.getByPlaceholderText("Ask NutriCoach..."), {
      target: { value: "Hello" },
    });
    fireEvent.click(screen.getByLabelText("Send message"));

    expect(mockImpact).toHaveBeenCalledOnce();
  });

  // One buzz per moment: tapping a suggested prompt used to buzz in the
  // prompt handler and again in handleSend.
  it("buzzes once when a suggested prompt is tapped", () => {
    renderComponent(<ChatScreen />);
    fireEvent.click(
      screen.getByLabelText("Suggested prompt: Suggest a healthy snack"),
    );

    expect(mockSendMessage).toHaveBeenCalledOnce();
    expect(mockImpact).toHaveBeenCalledOnce();
  });
});

describe("ChatScreen — reminder acknowledgment", () => {
  it("does not acknowledge reminders on mount", () => {
    renderComponent(<ChatScreen />);
    expect(mockAcknowledge).not.toHaveBeenCalled();
  });

  it("acknowledges reminders once after a successful send", async () => {
    renderComponent(<ChatScreen />);
    fireEvent.change(screen.getByPlaceholderText("Ask NutriCoach..."), {
      target: { value: "Hello" },
    });
    fireEvent.click(screen.getByLabelText("Send message"));

    await Promise.resolve();
    await Promise.resolve();
    expect(mockAcknowledge).toHaveBeenCalledOnce();
  });

  it("does not acknowledge again on a second send in the same session", async () => {
    renderComponent(<ChatScreen />);
    const input = screen.getByPlaceholderText("Ask NutriCoach...");
    const send = screen.getByLabelText("Send message");

    fireEvent.change(input, { target: { value: "First" } });
    fireEvent.click(send);
    await Promise.resolve();
    await Promise.resolve();

    fireEvent.change(input, { target: { value: "Second" } });
    fireEvent.click(send);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockAcknowledge).toHaveBeenCalledOnce();
  });
});

describe("ChatScreen — malformed conversationId (deep link)", () => {
  // A deep link like ocrecipes://chat/abc coerces conversationId to 0 via
  // linking's parseIntOrZero; ocrecipes://chat/-5 parses to -5 (parseIntOrZero
  // does not clamp negatives). Both are "present but not a positive integer" —
  // distinct from the omitted (undefined) in-app "start a new chat" case.
  it("shows a not-found state for a zero id", () => {
    mockRouteParams.value = { conversationId: 0 };

    renderComponent(<ChatScreen />);

    expect(screen.getByText("This chat couldn't be found.")).toBeDefined();
  });

  it("shows a not-found state for a negative id and never fetches with it", () => {
    mockRouteParams.value = { conversationId: -5 };

    renderComponent(<ChatScreen />);

    expect(screen.getByText("This chat couldn't be found.")).toBeDefined();
    // The malformed id must never reach the data hook — pass null through
    // instead of the raw value.
    expect(mockUseChatMessages).toHaveBeenLastCalledWith(null);
  });

  it("never creates a conversation or sends, even when an unparsed initialMessage query param rides along with a malformed id", async () => {
    // Unparsed deep-link query params land in route.params unfiltered (see
    // linking.ts's Scan/verifyBarcode comment) — a malformed id and
    // initialMessage can arrive together, e.g.
    // ocrecipes://chat/abc?initialMessage=hi.
    mockRouteParams.value = { conversationId: 0, initialMessage: "hi" };

    renderComponent(<ChatScreen />);

    await waitFor(() => {
      expect(screen.getByText("This chat couldn't be found.")).toBeDefined();
    });
    expect(mockCreateMutateAsync).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("never auto-sends a non-string initialMessage (a repeated link query key arrives as an array)", async () => {
    mockRouteParams.value = {
      conversationId: 42,
      initialMessage: ["a", "b"] as unknown as string,
    };

    renderComponent(<ChatScreen />);

    await new Promise((r) => setTimeout(r, 0));
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  // Positive control for the test above: without this, a passing
  // not.toHaveBeenCalled() there can't distinguish "the non-string guard
  // filtered the array" from "auto-send never fires for an existing
  // conversationId at all". A valid conversationId is non-null, so
  // handleSend takes its single-argument branch (ChatScreen.tsx's else
  // branch) — not the 3-arg create-flow signature used elsewhere in this
  // file for a null conversationId.
  it("auto-sends a string initialMessage for an existing conversation", async () => {
    mockRouteParams.value = {
      conversationId: 42,
      initialMessage: "hello there",
    };

    renderComponent(<ChatScreen />);

    await waitFor(() =>
      expect(mockSendMessage).toHaveBeenCalledWith("hello there"),
    );
  });

  // A chat/:id deep link builds a Coach stack holding only Chat, so there is
  // no header back button. canGoBack() is NOT a usable signal here: it bubbles
  // to the tab navigator (backBehavior "firstRoute") and returns true, and
  // goBack() would land on the Home tab. The exit always targets the list,
  // via popTo so a deep-linked Chat is replaced rather than left behind it.
  it("always returns to the chat list, even when canGoBack() is true", () => {
    mockRouteParams.value = { conversationId: 0 };
    mockCanGoBack.mockReturnValue(true);

    renderComponent(<ChatScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Back to chats" }));

    expect(mockPopTo).toHaveBeenCalledWith("ChatList");
    expect(mockGoBack).not.toHaveBeenCalled();
  });
});

describe("ChatScreen — missing conversationId (create flow)", () => {
  it("creates a conversation and sends the first message with the new id", async () => {
    mockRouteParams.value = undefined;
    mockCreateMutateAsync.mockResolvedValue({ id: 99 });

    renderComponent(<ChatScreen />);

    fireEvent.change(screen.getByPlaceholderText("Ask NutriCoach..."), {
      target: { value: "Hello" },
    });
    fireEvent.click(screen.getByLabelText("Send message"));

    await waitFor(() => expect(mockCreateMutateAsync).toHaveBeenCalled());
    await waitFor(() =>
      expect(mockSendMessage).toHaveBeenCalledWith("Hello", undefined, 99),
    );
  });
});

// P2-2026-09-23: the stream-end → message-refetch "pending assistant bubble"
// bridge was extracted into usePendingAssistantBridge (see
// usePendingAssistantBridge.test.ts for its own unit coverage). These tests
// prove ChatScreen is actually WIRED to it — a passing hook unit test alone
// doesn't prove that (docs/solutions/conventions/pure-utils-extraction-tests-dont-prove-wiring-2026-07-14.md).
describe("ChatScreen — pending assistant bubble (stream-end bridge)", () => {
  const seedUserMessage = {
    id: 1,
    role: "user" as const,
    content: "What should I eat today?",
    createdAt: new Date().toISOString(),
  };

  beforeEach(() => {
    // A non-empty conversation, so the screen renders the message FlatList
    // (where the pending bubble lives) instead of the empty-state prompts —
    // isolates the bridge behavior from that unrelated branch.
    mockUseChatMessages.mockReturnValue({
      data: [seedUserMessage],
      isLoading: false,
    });
  });

  it("shows the streamed reply as a pending bubble once streaming ends, then clears it once the real message is fetched", () => {
    const { rerender } = renderComponent(<ChatScreen />);

    mockSendMessageState.value = {
      streamingContent: "Here's a healthy snack idea.",
      isStreaming: true,
      streamError: null,
      requestError: null,
    };
    // While actively streaming the content renders via the live streaming
    // footer, not the pending bubble under test here — assert only on what
    // happens once streaming ends.
    rerender(<ChatScreen />);

    // Stream ends — useSendMessage clears streamingContent in the same
    // render as isStreaming flipping false (see useChat.ts's `finally`).
    mockSendMessageState.value = {
      streamingContent: "",
      isStreaming: false,
      streamError: null,
      requestError: null,
    };
    rerender(<ChatScreen />);
    expect(screen.getByText("Here's a healthy snack idea.")).toBeDefined();

    // The real assistant message lands in the next fetch — bubble clears.
    mockUseChatMessages.mockReturnValue({
      data: [
        seedUserMessage,
        {
          id: 2,
          role: "assistant",
          content: "Here's a healthy snack idea.",
          createdAt: new Date().toISOString(),
        },
      ],
      isLoading: false,
    });
    rerender(<ChatScreen />);
    // The persisted message has the same text as what was streamed, so a
    // still-present pending bubble would render it TWICE — assert exactly
    // one instance to prove the bubble actually cleared rather than merely
    // coexisting with the real message.
    expect(screen.getAllByText("Here's a healthy snack idea.")).toHaveLength(1);
  });

  it("never shows a pending bubble when the stream ends in error", () => {
    const { rerender } = renderComponent(<ChatScreen />);

    mockSendMessageState.value = {
      streamingContent: "partial reply",
      isStreaming: true,
      streamError: null,
      requestError: null,
    };
    rerender(<ChatScreen />);

    mockSendMessageState.value = {
      streamingContent: "",
      isStreaming: false,
      streamError: true,
      requestError: null,
    };
    rerender(<ChatScreen />);

    expect(screen.queryByText("partial reply")).toBeNull();
  });
});

// P2-2026-09-23 (L16): the toast used to claim a partial response "may be
// visible" even though useChat.ts always discards the streamed content on
// error — this fails on main's old copy and passes once it's corrected to
// match actual behavior (matches the Coach's #1068 copy in
// CoachOverlayContent.tsx).
describe("ChatScreen — stream-interrupted toast copy", () => {
  it("tells the user the reply was interrupted, not that a partial reply may be visible", () => {
    const { rerender } = renderComponent(<ChatScreen />);

    mockSendMessageState.value = {
      streamingContent: "",
      isStreaming: false,
      streamError: true,
      requestError: null,
    };
    rerender(<ChatScreen />);

    expect(mockToastError).toHaveBeenCalledWith(
      "Response interrupted. Try sending again.",
    );
    expect(mockToastError).not.toHaveBeenCalledWith(
      expect.stringContaining("Partial response may be visible"),
    );
  });
});

// P2-2026-09-29: ChatScreen is the half of "Coach reply ready" that knows
// whether the user is looking at a conversation. useSendMessage's done handler
// (useChat.test.ts) compares against what this screen reports as on screen, so
// these tests prove the screen is actually WIRED to that store — a passing
// store unit test alone doesn't (docs/solutions/conventions/
// pure-utils-extraction-tests-dont-prove-wiring-2026-07-14.md). They run the
// real store against a real QueryClient; only the navigator's focus is faked.
describe("ChatScreen — Coach reply ready (viewed conversation + unread marks)", () => {
  function renderWithClient() {
    const { queryClient, wrapper } = createQueryWrapper();
    const utils = render(<ChatScreen />, { wrapper });
    return { queryClient, ...utils };
  }

  it("opts useSendMessage into the reply-ready notification", () => {
    renderWithClient();

    expect(mockUseSendMessage).toHaveBeenLastCalledWith(42, {
      notifyWhenAway: true,
    });
  });

  it("reports its conversation as on screen while focused", () => {
    const { queryClient } = renderWithClient();

    expect(getViewedCoachConversation(queryClient)).toBe(42);
  });

  // A bottom-tab screen stays MOUNTED when its tab loses focus: this is the
  // case an unmount-only signal misses.
  it("stops reporting it on blur while still mounted (switched tab), and resumes on focus", () => {
    const { queryClient, rerender } = renderWithClient();

    focusState.focused = false;
    rerender(<ChatScreen />);
    expect(getViewedCoachConversation(queryClient)).toBeNull();

    focusState.focused = true;
    rerender(<ChatScreen />);
    expect(getViewedCoachConversation(queryClient)).toBe(42);
  });

  it("stops reporting it when the screen unmounts (popped back)", () => {
    const { queryClient, unmount } = renderWithClient();

    unmount();

    expect(getViewedCoachConversation(queryClient)).toBeNull();
  });

  it("opening the conversation clears its unread mark, and only its own", () => {
    const { queryClient, wrapper } = createQueryWrapper();
    markCoachReplyUnread(queryClient, 42);
    markCoachReplyUnread(queryClient, 7);

    render(<ChatScreen />, { wrapper });

    expect(getUnreadCoachReplyIds(queryClient)).toEqual([7]);
  });

  it("a reply that lands while the screen is blurred is marked, and refocusing clears the mark", () => {
    const { queryClient, rerender } = renderWithClient();
    focusState.focused = false;
    rerender(<ChatScreen />);

    noteCoachReplyFinished(queryClient, 42);
    expect(getUnreadCoachReplyIds(queryClient)).toEqual([42]);

    focusState.focused = true;
    rerender(<ChatScreen />);
    expect(getUnreadCoachReplyIds(queryClient)).toEqual([]);
  });

  it("a reply that lands while the screen is focused is not marked", () => {
    const { queryClient } = renderWithClient();

    noteCoachReplyFinished(queryClient, 42);

    expect(getUnreadCoachReplyIds(queryClient)).toEqual([]);
  });

  // The new-chat flow has no conversation until the first send creates one and
  // navigation.setParams delivers its id; the focus callback re-runs then.
  it("reports no conversation in the new-chat flow, then the created one once its id lands", () => {
    mockRouteParams.value = undefined;
    const { queryClient, rerender } = renderWithClient();
    expect(getViewedCoachConversation(queryClient)).toBeNull();

    mockRouteParams.value = { conversationId: 99 };
    rerender(<ChatScreen />);

    expect(getViewedCoachConversation(queryClient)).toBe(99);
  });

  it("follows the screen when it is re-pointed at another conversation", () => {
    const { queryClient, rerender } = renderWithClient();

    mockRouteParams.value = { conversationId: 7 };
    rerender(<ChatScreen />);

    expect(getViewedCoachConversation(queryClient)).toBe(7);
  });

  it.each([0, -5])(
    "never reports a malformed conversation id (%i) as on screen",
    (badId) => {
      mockRouteParams.value = { conversationId: badId };

      const { queryClient } = renderWithClient();

      expect(getViewedCoachConversation(queryClient)).toBeNull();
    },
  );
});
