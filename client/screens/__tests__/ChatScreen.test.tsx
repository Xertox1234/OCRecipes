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
  mockNavigate,
  mockCanGoBack,
  mockRouteParams,
  mockUseChatMessages,
} = vi.hoisted(() => ({
  mockGoBack: vi.fn(),
  mockNavigate: vi.fn(),
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
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    setParams: mockSetParams,
    goBack: mockGoBack,
    navigate: mockNavigate,
    canGoBack: mockCanGoBack,
  }),
  useRoute: () => ({ params: mockRouteParams.value }),
}));

vi.mock("@/hooks/useChat", () => ({
  useChatMessages: (conversationId: number | null) =>
    mockUseChatMessages(conversationId),
  useSendMessage: () => ({
    sendMessage: mockSendMessage,
    streamingContent: "",
    isStreaming: false,
    streamError: null,
    requestError: null,
  }),
  useCreateConversation: () => ({ mutateAsync: mockCreateMutateAsync }),
}));

vi.mock("@/hooks/useAcknowledgeReminders", () => ({
  useAcknowledgeReminders: () => ({ acknowledge: mockAcknowledge }),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockRouteParams.value = { conversationId: 42 };
  mockSendMessage.mockResolvedValue(undefined);
  mockAcknowledge.mockResolvedValue(undefined);
  mockUseChatMessages.mockReturnValue({ data: [], isLoading: false });
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

  // A chat/:id deep link builds a stack holding only Chat, so there is no
  // header back button — the not-found view must offer its own way out.
  it("offers a back action that goes to the chat list when nothing is behind it", () => {
    mockRouteParams.value = { conversationId: 0 };
    mockCanGoBack.mockReturnValue(false);

    renderComponent(<ChatScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));

    expect(mockNavigate).toHaveBeenCalledWith("ChatList");
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it("goes back when there is a screen behind it", () => {
    mockRouteParams.value = { conversationId: 0 };
    mockCanGoBack.mockReturnValue(true);

    renderComponent(<ChatScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));

    expect(mockGoBack).toHaveBeenCalledOnce();
    expect(mockNavigate).not.toHaveBeenCalled();
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
