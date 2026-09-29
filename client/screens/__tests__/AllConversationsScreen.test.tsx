// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import AllConversationsScreen from "../AllConversationsScreen";

const {
  mockGoBack,
  mockCanGoBack,
  mockNavigate,
  mockReset,
  mockUseChatConversations,
} = vi.hoisted(() => ({
  mockGoBack: vi.fn(),
  mockCanGoBack: vi.fn(),
  mockNavigate: vi.fn(),
  mockReset: vi.fn(),
  mockUseChatConversations: vi.fn(),
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    goBack: mockGoBack,
    canGoBack: mockCanGoBack,
    navigate: mockNavigate,
    reset: mockReset,
  }),
}));

vi.mock("@/hooks/useChat", () => ({
  useChatConversations: (...args: unknown[]) =>
    mockUseChatConversations(...args),
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

    expect(mockNavigate).toHaveBeenCalledWith("CoachPro", {
      selectedConversationId: 7,
    });
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
