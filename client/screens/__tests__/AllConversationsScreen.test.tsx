// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import AllConversationsScreen from "../AllConversationsScreen";

const { mockGoBack, mockCanGoBack, mockNavigate, mockUseChatConversations } =
  vi.hoisted(() => ({
    mockGoBack: vi.fn(),
    mockCanGoBack: vi.fn(),
    mockNavigate: vi.fn(),
    mockUseChatConversations: vi.fn(),
  }));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    goBack: mockGoBack,
    canGoBack: mockCanGoBack,
    navigate: mockNavigate,
  }),
}));

vi.mock("@/hooks/useChat", () => ({
  useChatConversations: () => mockUseChatConversations(),
  usePinConversation: () => ({ mutateAsync: vi.fn() }),
  useDeleteConversation: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockCanGoBack.mockReturnValue(true);
  mockUseChatConversations.mockReturnValue({ data: [], isLoading: false });
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
    expect(mockNavigate).toHaveBeenCalledWith("Main", { screen: "CoachTab" });
  });
});
