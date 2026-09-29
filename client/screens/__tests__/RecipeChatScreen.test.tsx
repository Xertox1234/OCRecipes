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
  mockAbortStream,
  mockCreateConversationMutateAsync,
  mockSaveRecipeMutateAsync,
  mockChatMessagesData,
  mockSendMessageState,
} = vi.hoisted(() => ({
  mockGoBack: vi.fn(),
  mockCanGoBack: vi.fn(),
  mockNavigate: vi.fn(),
  mockReset: vi.fn(),
  mockRouteParams: {
    value: undefined as
      | {
          conversationId?: number;
          initialMessage?: string;
          remixSourceRecipeId?: number;
          remixSourceRecipeTitle?: string;
        }
      | undefined,
  },
  mockImpact: vi.fn(),
  mockNotification: vi.fn(),
  mockSendMessage: vi.fn(),
  mockAbortStream: vi.fn(),
  mockCreateConversationMutateAsync: vi.fn(),
  mockSaveRecipeMutateAsync: vi.fn(),
  mockChatMessagesData: { value: [] as ChatMessage[] },
  // A mutable ref so tests can simulate useSendMessage's streaming/recipe/
  // error state changing across a rerender (e.g. a stream starting then
  // ending).
  mockSendMessageState: {
    value: {
      streamingContent: "",
      streamingRecipe: null as { title: string } | null,
      streamingFinder: null as unknown,
      streamingStatus: null as string | null,
      isStreaming: false,
      streamError: false,
      requestError: null as string | null,
    },
  },
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
    abortStream: mockAbortStream,
    ...mockSendMessageState.value,
  }),
  useSaveRecipeFromChat: () => ({
    mutateAsync: mockSaveRecipeMutateAsync,
    isPending: false,
  }),
}));

vi.mock("@/hooks/usePremiumFeatures", () => ({
  usePremiumFeature: () => true,
}));

vi.mock("@/components/UpgradeModal", () => ({
  UpgradeModal: ({ visible }: { visible: boolean }) =>
    visible ? <div data-testid="upgrade-modal" /> : null,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockCanGoBack.mockReturnValue(true);
  mockRouteParams.value = undefined;
  mockChatMessagesData.value = [];
  mockSendMessageState.value = {
    streamingContent: "",
    streamingRecipe: null,
    streamingFinder: null,
    streamingStatus: null,
    isStreaming: false,
    streamError: false,
    requestError: null,
  };
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

describe("RecipeChatScreen — initialMessage route param (Home's Generate Recipe drawer)", () => {
  it("sends the prefilled request once, in a new recipe conversation", async () => {
    mockCreateConversationMutateAsync.mockResolvedValue({ id: 11 });
    mockRouteParams.value = {
      initialMessage: "A Mediterranean dinner for two",
    };

    renderComponent(<RecipeChatScreen />);

    await waitFor(() =>
      expect(mockSendMessage).toHaveBeenCalledWith(
        "A Mediterranean dinner for two",
        undefined,
        11,
      ),
    );
    expect(mockCreateConversationMutateAsync).toHaveBeenCalledWith({
      title: "New Recipe Chat",
      type: "recipe",
    });
  });

  it("does not send it again on a re-render", async () => {
    mockCreateConversationMutateAsync.mockResolvedValue({ id: 11 });
    mockRouteParams.value = {
      initialMessage: "A Mediterranean dinner for two",
    };

    const { rerender } = renderComponent(<RecipeChatScreen />);
    await waitFor(() => expect(mockSendMessage).toHaveBeenCalledTimes(1));

    rerender(<RecipeChatScreen />);
    rerender(<RecipeChatScreen />);

    await waitFor(() => expect(mockSendMessage).toHaveBeenCalledTimes(1));
    expect(mockCreateConversationMutateAsync).toHaveBeenCalledTimes(1);
  });

  it("ignores a non-string initialMessage (e.g. a repeated link query key)", async () => {
    mockCreateConversationMutateAsync.mockResolvedValue({ id: 11 });
    mockRouteParams.value = {
      initialMessage: ["a", "b"] as unknown as string,
    };

    renderComponent(<RecipeChatScreen />);

    await new Promise((r) => setTimeout(r, 0));
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockCreateConversationMutateAsync).not.toHaveBeenCalled();
  });

  it("sends nothing on open when there is no initialMessage", async () => {
    renderComponent(<RecipeChatScreen />);

    await new Promise((r) => setTimeout(r, 0));
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockCreateConversationMutateAsync).not.toHaveBeenCalled();
  });
});

// P2-2026-09-24: recipe/remix generation keeps running server-side after a
// disconnect (finish-and-save policy) — the client's job is to stop
// listening on its own dead XHR and mark the conversation stale so the next
// view refetches the finished reply. useSendMessage owns the invalidation
// (see useChat.test.ts); this screen's only responsibility is calling
// abortStream() on unmount.
describe("RecipeChatScreen — aborts the stream on unmount", () => {
  it("calls abortStream when the screen unmounts", () => {
    const { unmount } = renderComponent(<RecipeChatScreen />);

    expect(mockAbortStream).not.toHaveBeenCalled();
    unmount();

    expect(mockAbortStream).toHaveBeenCalledOnce();
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

// P2-2026-09-23: the stream-end → message-refetch "pending assistant bubble"
// bridge was extracted into usePendingAssistantBridge, shared with
// ChatScreen (see usePendingAssistantBridge.test.ts for its own unit
// coverage). These tests prove RecipeChatScreen is actually WIRED to it,
// with its object (content + recipe) payload — a passing hook unit test
// alone doesn't prove that
// (docs/solutions/conventions/pure-utils-extraction-tests-dont-prove-wiring-2026-07-14.md).
describe("RecipeChatScreen — pending assistant bubble (stream-end bridge)", () => {
  const seedUserMessage: ChatMessage = {
    id: 1,
    conversationId: 1,
    role: "user",
    content: "Give me a pasta recipe",
    metadata: null,
    createdAt: new Date().toISOString(),
  };

  beforeEach(() => {
    mockRouteParams.value = { conversationId: 1 };
    mockChatMessagesData.value = [seedUserMessage];
  });

  it("shows the streamed reply as a pending bubble once streaming ends, then clears it once the real message is fetched", () => {
    const { rerender } = renderComponent(<RecipeChatScreen />);

    mockSendMessageState.value = {
      streamingContent: "Here's a pasta recipe for you.",
      streamingRecipe: null,
      isStreaming: true,
      streamError: false,
      requestError: null,
    };
    rerender(<RecipeChatScreen />);

    // Stream ends — useSendMessage clears streamingContent/streamingRecipe
    // in the same render as isStreaming flipping false.
    mockSendMessageState.value = {
      streamingContent: "",
      streamingRecipe: null,
      isStreaming: false,
      streamError: false,
      requestError: null,
    };
    rerender(<RecipeChatScreen />);
    expect(screen.getByText("Here's a pasta recipe for you.")).toBeDefined();

    // The real assistant message lands in the next fetch — bubble clears.
    mockChatMessagesData.value = [
      seedUserMessage,
      {
        id: 2,
        conversationId: 1,
        role: "assistant",
        content: "Here's a pasta recipe for you.",
        metadata: null,
        createdAt: new Date().toISOString(),
      },
    ];
    rerender(<RecipeChatScreen />);
    // Same reasoning as ChatScreen's equivalent test: the persisted message
    // shares the streamed text, so a still-present bubble would duplicate it.
    expect(screen.getAllByText("Here's a pasta recipe for you.")).toHaveLength(
      1,
    );
  });

  // Parity with the pre-extraction screen: capture is gated on the RAW
  // content, and a bubble shows only if the captured (stripped) content or a
  // recipe is present. A stream that is only an opening ```json fence strips
  // to "" and must not leave an earlier fragment behind as a bubble.
  it("shows no pending bubble when the stream strips to empty and no recipe arrives", () => {
    const { rerender } = renderComponent(<RecipeChatScreen />);

    for (const streamingContent of ["STALE-FRAGMENT", "```json{"]) {
      mockSendMessageState.value = {
        streamingContent,
        streamingRecipe: null,
        isStreaming: true,
        streamError: false,
        requestError: null,
      };
      rerender(<RecipeChatScreen />);
    }

    mockSendMessageState.value = {
      streamingContent: "",
      streamingRecipe: null,
      isStreaming: false,
      streamError: false,
      requestError: null,
    };
    rerender(<RecipeChatScreen />);

    expect(screen.queryByText("STALE-FRAGMENT")).toBeNull();
  });

  it("never shows a pending bubble when the stream ends in error", () => {
    const { rerender } = renderComponent(<RecipeChatScreen />);

    mockSendMessageState.value = {
      streamingContent: "partial recipe text",
      streamingRecipe: null,
      isStreaming: true,
      streamError: false,
      requestError: null,
    };
    rerender(<RecipeChatScreen />);

    mockSendMessageState.value = {
      streamingContent: "",
      streamingRecipe: null,
      isStreaming: false,
      streamError: true,
      requestError: null,
    };
    rerender(<RecipeChatScreen />);

    expect(screen.queryByText("partial recipe text")).toBeNull();
    // Same L16 copy fix as ChatScreen's toast (P2-2026-09-23): no partial
    // content is ever shown here, so the inline error bubble must not imply
    // otherwise.
    expect(
      screen.getByText("Response interrupted. Try sending again."),
    ).toBeDefined();
    expect(screen.queryByText(/may be incomplete/i)).toBeNull();
  });
});

// P2-2026-09-25: assistant text (streaming footer + persisted messages) must
// render through MarkdownText, with the accessibilityLabel built from
// spokenMarkdown(), so no raw `![`, `](`, URL, `**` or list marker is ever
// shown or spoken. User and error bubbles are app-authored/user-typed text,
// not model output, and stay raw (ChatBubble parity, #1087).
describe("RecipeChatScreen — assistant markdown rendering", () => {
  const REPLY_WITH_MARKDOWN =
    "Here's your recipe!\n" +
    "![Recipe photo](https://example.com/photo.jpg)\n" +
    "Check the [full recipe](https://example.com/link) online.\n" +
    "This dish is **amazing**.\n" +
    "- Preheat the oven\n" +
    "- Mix the ingredients";

  // What spokenMarkdown() produces for the reply above: image line dropped
  // entirely, link collapsed to its text, bold markers stripped, bullet
  // markers stripped — hard-coded here (not computed by calling
  // spokenMarkdown in the test) so the test pins actual behavior.
  const REPLY_SPOKEN_CLEAN =
    "Here's your recipe!\n" +
    "Check the full recipe online.\n" +
    "This dish is amazing.\n" +
    "Preheat the oven\n" +
    "Mix the ingredients";

  beforeEach(() => {
    mockRouteParams.value = { conversationId: 1 };
  });

  it("renders a persisted assistant reply through MarkdownText — no raw image/link/bold/list syntax shown, and the spoken label matches", () => {
    mockChatMessagesData.value = [
      {
        id: 1,
        conversationId: 1,
        role: "assistant",
        content: REPLY_WITH_MARKDOWN,
        metadata: null,
        createdAt: new Date().toISOString(),
      },
    ];

    const { container } = renderComponent(<RecipeChatScreen />);

    // Clean visible pieces render.
    expect(screen.getByText("Here's your recipe!")).toBeDefined();
    expect(screen.getByText("Check the full recipe online.")).toBeDefined();
    // Bold text renders as its own segment (a full-string match would fail
    // once ** splits "This dish is amazing." into nested Text nodes).
    expect(screen.getByText("amazing")).toBeDefined();
    expect(screen.getByText("Preheat the oven")).toBeDefined();
    expect(screen.getByText("Mix the ingredients")).toBeDefined();

    // No raw markdown syntax anywhere in the rendered output.
    expect(container.textContent).not.toContain("![");
    expect(container.textContent).not.toContain("](");
    expect(container.textContent).not.toContain("http");
    expect(container.textContent).not.toContain("**");
    expect(container.textContent).not.toContain("- Preheat");
    expect(container.textContent).not.toContain("- Mix");

    // Spoken label matches what's on screen. Disable RTL's default
    // whitespace-collapsing normalizer — this label is genuinely multi-line
    // (spokenMarkdown joins with "\n"). The default collapses the node's
    // label to single spaces but leaves a string matcher untouched, so a
    // multi-line expected string could never match (measured: both label
    // tests fail without this).
    expect(
      screen.getByLabelText(`RecipeChef: ${REPLY_SPOKEN_CLEAN}`, {
        normalizer: (text) => text,
      }),
    ).toBeDefined();
  });

  it("renders the streaming footer's assistant reply through MarkdownText with a matching spoken label", () => {
    const { rerender, container } = renderComponent(<RecipeChatScreen />);

    mockSendMessageState.value = {
      streamingContent: REPLY_WITH_MARKDOWN,
      streamingRecipe: null,
      isStreaming: true,
      streamError: false,
      requestError: null,
    };
    rerender(<RecipeChatScreen />);

    expect(screen.getByText("Here's your recipe!")).toBeDefined();
    expect(screen.getByText("amazing")).toBeDefined();
    expect(container.textContent).not.toContain("![");
    expect(container.textContent).not.toContain("**");
    expect(
      screen.getByLabelText(`RecipeChef: ${REPLY_SPOKEN_CLEAN}`, {
        normalizer: (text) => text,
      }),
    ).toBeDefined();
  });

  it("keeps a user message's markdown raw — not run through MarkdownText", () => {
    mockChatMessagesData.value = [
      {
        id: 1,
        conversationId: 1,
        role: "user",
        content: "Try **x** ingredient instead",
        metadata: null,
        createdAt: new Date().toISOString(),
      },
    ];

    renderComponent(<RecipeChatScreen />);

    expect(screen.getByText("Try **x** ingredient instead")).toBeDefined();
    expect(
      screen.getByLabelText("You: Try **x** ingredient instead"),
    ).toBeDefined();
  });

  it("keeps an error bubble's text raw — not run through MarkdownText", () => {
    const { rerender } = renderComponent(<RecipeChatScreen />);

    mockSendMessageState.value = {
      streamingContent: "",
      streamingRecipe: null,
      isStreaming: false,
      streamError: false,
      requestError: "**Premium** required for this recipe",
    };
    rerender(<RecipeChatScreen />);

    expect(
      screen.getByText("**Premium** required for this recipe"),
    ).toBeDefined();
    expect(
      screen.getByLabelText("Error: **Premium** required for this recipe"),
    ).toBeDefined();
  });
});

// The server persists the recipe image at the TOP level of the message
// metadata (recipeChatMetadataSchema.imageUrl), not inside metadata.recipe —
// the recipe object arrives on the stream before its image does. A card
// rebuilt from the refetched message must read it from there, or the image
// the user just watched arrive vanishes on refetch.
describe("RecipeChatScreen — persisted recipe image", () => {
  const persistedRecipe = {
    title: "Test Recipe",
    description: "A tasty test recipe",
    difficulty: "easy",
    timeEstimate: "20 min",
    servings: 2,
    ingredients: [{ name: "chicken", quantity: "1", unit: "lb" }],
    instructions: ["Cook it"],
    dietTags: [],
  };

  function persistedMessage(imageUrl: string | null): ChatMessage {
    return {
      id: 10,
      conversationId: 1,
      role: "assistant",
      content: "Here's a recipe for you.",
      metadata: {
        metadataVersion: 1,
        recipe: persistedRecipe,
        allergenWarning: null,
        imageUrl,
      },
      createdAt: new Date().toISOString(),
    };
  }

  it("shows the image saved at metadata.imageUrl", () => {
    mockRouteParams.value = { conversationId: 1 };
    mockChatMessagesData.value = [
      persistedMessage("https://cdn.example.com/r.jpg"),
    ];

    const { container } = renderComponent(<RecipeChatScreen />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "https://cdn.example.com/r.jpg",
    );
  });

  it("shows the no-image placeholder when the saved image is null", () => {
    mockRouteParams.value = { conversationId: 1 };
    mockChatMessagesData.value = [persistedMessage(null)];

    const { container } = renderComponent(<RecipeChatScreen />);
    expect(screen.getByText("image")).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("RecipeChatScreen — recipe finder", () => {
  const FLOW_OLD = "00000000-0000-4000-8000-000000000000";
  const FLOW_NEW = "11111111-1111-4111-8111-111111111111";
  const block = (flowId: string) => ({
    type: "recipe_results",
    source: "community",
    items: [
      {
        id: 12,
        source: "community",
        title: "Mediterranean Quinoa Salad",
        imageUrl: null,
        readyInMinutes: null,
        calories: 350,
      },
    ],
    actions: ["search_online", "generate", "none_of_these"],
    notice: null,
    flow: {
      flowId,
      stage: "results",
      request: "Mediterranean",
      query: { q: "mediterranean" },
      round: 0,
      shownIds: [],
    },
  });
  const finderMessage = (id: number, flowId: string): ChatMessage => ({
    id,
    conversationId: 11,
    role: "assistant",
    content:
      "Here are 1 community recipe:\n1. Mediterranean Quinoa Salad (350 cal)",
    metadata: { metadataVersion: 1, finder: block(flowId) },
    createdAt: new Date().toISOString(),
  });

  beforeEach(() => {
    mockRouteParams.value = { conversationId: 11 };
  });

  it("renders the shared finder component instead of the fallback text", () => {
    mockChatMessagesData.value = [finderMessage(2, FLOW_NEW)];
    renderComponent(<RecipeChatScreen />);
    expect(screen.getByText("From the community")).toBeDefined();
    expect(screen.queryByText(/Here are 1 community recipe/)).toBeNull();
  });

  it("a button tap sends its label with the finderAction", () => {
    mockChatMessagesData.value = [finderMessage(2, FLOW_NEW)];
    renderComponent(<RecipeChatScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    expect(mockSendMessage).toHaveBeenCalledWith("Generate", undefined, 11, {
      finderAction: { type: "generate", flowId: FLOW_NEW },
    });
  });

  it("only the latest finder message's buttons are active", () => {
    mockChatMessagesData.value = [
      finderMessage(2, FLOW_OLD),
      finderMessage(4, FLOW_NEW),
    ];
    renderComponent(<RecipeChatScreen />);
    const [older, newer] = screen.getAllByRole("button", { name: "Generate" });
    expect(older.getAttribute("aria-disabled")).toBe("true");
    expect(newer.getAttribute("aria-disabled")).toBe("false");
  });

  it("a row opens the recipe detail (viewing a result is not leaving the flow)", () => {
    mockChatMessagesData.value = [finderMessage(2, FLOW_NEW)];
    renderComponent(<RecipeChatScreen />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Mediterranean Quinoa Salad, 350 calories. Opens recipe.",
      }),
    );
    expect(mockNavigate).toHaveBeenCalledWith("FeaturedRecipeDetail", {
      recipeId: 12,
      recipeType: "community",
    });
  });

  it("the thinking bubble shows the finder's progress text", () => {
    mockChatMessagesData.value = [];
    mockSendMessageState.value = {
      ...mockSendMessageState.value,
      isStreaming: true,
      streamingStatus: "Searching community recipes…",
    };
    renderComponent(<RecipeChatScreen />);
    expect(screen.getByText("Searching community recipes…")).toBeDefined();
  });

  it("buttons are inactive while a reply is streaming", () => {
    mockChatMessagesData.value = [finderMessage(2, FLOW_NEW)];
    mockSendMessageState.value = {
      ...mockSendMessageState.value,
      isStreaming: true,
    };
    renderComponent(<RecipeChatScreen />);
    expect(
      screen
        .getByRole("button", { name: "Generate" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
  });
});
