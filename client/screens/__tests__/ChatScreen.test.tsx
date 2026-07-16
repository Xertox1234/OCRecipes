// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import ChatScreen from "../ChatScreen";

const {
  mockSendMessage,
  mockAcknowledge,
  mockCreateMutateAsync,
  mockSetParams,
} = vi.hoisted(() => ({
  mockSendMessage: vi.fn(),
  mockAcknowledge: vi.fn(),
  mockCreateMutateAsync: vi.fn(),
  mockSetParams: vi.fn(),
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ setParams: mockSetParams }),
  useRoute: () => ({ params: { conversationId: 42 } }),
}));

vi.mock("@/hooks/useChat", () => ({
  useChatMessages: () => ({ data: [], isLoading: false }),
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
  mockSendMessage.mockResolvedValue(undefined);
  mockAcknowledge.mockResolvedValue(undefined);
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
