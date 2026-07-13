// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import * as Haptics from "expo-haptics";
import { renderComponent } from "../../../test/utils/render-component";
import RecipeChatScreen from "../RecipeChatScreen";
import type { ChatMessage } from "@/hooks/useChat";

const {
  mockGoBack,
  mockCanGoBack,
  mockNavigate,
  mockReset,
  mockRouteParams,
  mockImpact,
  mockNotification,
  mockSendMessage,
  mockCreateConversationMutateAsync,
  mockSaveRecipeMutateAsync,
  mockChatMessagesData,
} = vi.hoisted(() => ({
  mockGoBack: vi.fn(),
  mockCanGoBack: vi.fn(),
  mockNavigate: vi.fn(),
  mockReset: vi.fn(),
  mockRouteParams: {
    value: undefined as
      | {
          conversationId?: number;
          remixSourceRecipeId?: number;
          remixSourceRecipeTitle?: string;
        }
      | undefined,
  },
  mockImpact: vi.fn(),
  mockNotification: vi.fn(),
  mockSendMessage: vi.fn(),
  mockCreateConversationMutateAsync: vi.fn(),
  mockSaveRecipeMutateAsync: vi.fn(),
  mockChatMessagesData: { value: [] as ChatMessage[] },
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    goBack: mockGoBack,
    canGoBack: mockCanGoBack,
    navigate: mockNavigate,
    reset: mockReset,
  }),
  useRoute: () => ({ params: mockRouteParams.value }),
}));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: mockImpact,
    notification: mockNotification,
    selection: vi.fn(),
    disabled: false,
  }),
}));

vi.mock("@/hooks/useChat", () => ({
  useCreateConversation: () => ({
    mutateAsync: mockCreateConversationMutateAsync,
    isPending: false,
  }),
  useChatMessages: () => ({ data: mockChatMessagesData.value }),
  useSendMessage: () => ({
    sendMessage: mockSendMessage,
    streamingContent: "",
    streamingRecipe: null,
    isStreaming: false,
    streamError: false,
    requestError: null,
  }),
  useSaveRecipeFromChat: () => ({
    mutateAsync: mockSaveRecipeMutateAsync,
    isPending: false,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockCanGoBack.mockReturnValue(true);
  mockRouteParams.value = undefined;
  mockChatMessagesData.value = [];
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

// Raw expo-haptics calls bypass useHaptics()'s reducedMotion gating and its
// Android performAndroidHapticsAsync routing — these assert every haptic
// trigger in this screen goes through the mocked hook, never the raw module.
describe("RecipeChatScreen — haptics route through useHaptics()", () => {
  const recipeMessage: ChatMessage = {
    id: 10,
    conversationId: 1,
    role: "assistant",
    content: "Here's a recipe for you.",
    metadata: {
      recipe: {
        title: "Test Recipe",
        description: "A tasty test recipe",
        difficulty: "easy",
        timeEstimate: "20 min",
        servings: 2,
        ingredients: [{ name: "chicken", quantity: "1", unit: "lb" }],
        instructions: ["Cook it"],
        dietTags: [],
      },
    },
    createdAt: new Date().toISOString(),
  };

  it("fires impact feedback via useHaptics (not raw expo-haptics) when sending a message", async () => {
    mockCreateConversationMutateAsync.mockResolvedValue({ id: 1 });

    renderComponent(<RecipeChatScreen />);
    fireEvent.change(screen.getByLabelText("Recipe request"), {
      target: { value: "Give me a pasta recipe" },
    });
    fireEvent.click(screen.getByLabelText("Send message"));

    expect(mockImpact).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
    expect(mockNotification).not.toHaveBeenCalled();
    // Raw module must never be called directly by this screen.
    expect(Haptics.impactAsync).not.toHaveBeenCalled();

    await waitFor(() => expect(mockSendMessage).toHaveBeenCalled());
  });

  it("fires success notification via useHaptics (not raw expo-haptics) when saving a recipe succeeds", async () => {
    mockRouteParams.value = { conversationId: 1 };
    mockChatMessagesData.value = [recipeMessage];
    mockSaveRecipeMutateAsync.mockResolvedValue({});

    renderComponent(<RecipeChatScreen />);
    fireEvent.click(screen.getByLabelText("Save Test Recipe recipe"));

    await waitFor(() =>
      expect(mockNotification).toHaveBeenCalledWith(
        Haptics.NotificationFeedbackType.Success,
      ),
    );
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
  });

  it("fires error notification via useHaptics (not raw expo-haptics) when saving a recipe fails", async () => {
    mockRouteParams.value = { conversationId: 1 };
    mockChatMessagesData.value = [recipeMessage];
    mockSaveRecipeMutateAsync.mockRejectedValue(new Error("save failed"));

    renderComponent(<RecipeChatScreen />);
    fireEvent.click(screen.getByLabelText("Save Test Recipe recipe"));

    await waitFor(() =>
      expect(mockNotification).toHaveBeenCalledWith(
        Haptics.NotificationFeedbackType.Error,
      ),
    );
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
  });
});
