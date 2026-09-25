// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import ChatScreen from "../ChatScreen";

const {
  mockSendMessage,
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
}));

vi.mock("@/hooks/useChat", () => ({
  useChatMessages: (conversationId: number | null) =>
    mockUseChatMessages(conversationId),
  useSendMessage: () => ({
    sendMessage: mockSendMessage,
    ...mockSendMessageState.value,
  }),
  useCreateConversation: () => ({ mutateAsync: mockCreateMutateAsync }),
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
