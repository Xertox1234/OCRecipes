// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import RecipeChatScreen from "../RecipeChatScreen";

const { mockGoBack, mockCanGoBack, mockNavigate, mockReset } = vi.hoisted(
  () => ({
    mockGoBack: vi.fn(),
    mockCanGoBack: vi.fn(),
    mockNavigate: vi.fn(),
    mockReset: vi.fn(),
  }),
);

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    goBack: mockGoBack,
    canGoBack: mockCanGoBack,
    navigate: mockNavigate,
    reset: mockReset,
  }),
  useRoute: () => ({ params: undefined }),
}));

vi.mock("@/hooks/useChat", () => ({
  useCreateConversation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useChatMessages: () => ({ data: [] }),
  useSendMessage: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
    isStreaming: false,
    streamingContent: "",
    streamingRecipe: null,
  }),
  useSaveRecipeFromChat: () => ({ mutate: vi.fn(), isPending: false }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockCanGoBack.mockReturnValue(true);
});

describe("RecipeChatScreen — safe back navigation", () => {
  // A cold-start deep link to recipe-chat/:conversationId can land this
  // screen as the stack's sole entry — goBack() would be a silent no-op.
  it("goes back normally when a back stack exists", () => {
    mockCanGoBack.mockReturnValue(true);

    renderComponent(<RecipeChatScreen />);
    fireEvent.click(screen.getByLabelText("Close"));

    expect(mockGoBack).toHaveBeenCalledOnce();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("falls back to Main when there is no back stack", () => {
    mockCanGoBack.mockReturnValue(false);

    renderComponent(<RecipeChatScreen />);
    fireEvent.click(screen.getByLabelText("Close"));

    expect(mockGoBack).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockReset).toHaveBeenCalledWith({
      index: 0,
      routes: [{ name: "Main" }],
    });
  });
});
