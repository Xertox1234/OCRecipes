// @vitest-environment jsdom
/**
 * Branch-coverage harness for CoachChat — complements CoachChat.test.tsx
 * (which covers only the daily-limit banner / upgrade CTA).
 *
 * Strategy: child components (CoachChatBase, BlockRenderer, StreamingBubble,
 * ChatBubble) are mocked as thin doubles that surface their callback props as
 * clickable buttons. That lets these tests drive CoachChat's internal handlers
 * (handleSend, handleRetry, handleBlockAction, handleQuickReply,
 * handleCommitmentAccept) and exercise the streaming/state branches directly,
 * without real network, SSE, navigation, or IAP behavior.
 *
 * The hooks (useCoachStream, useChat, useSpeechToText, useTTS, premium feature)
 * are mocked via vi.hoisted mutable refs so each test configures the inputs it
 * needs before render.
 */
import React from "react";
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  beforeAll,
  afterAll,
} from "vitest";
import { act, screen, fireEvent, waitFor } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import CoachChat from "../CoachChat";
import type { ChatMessage } from "@/hooks/useChat";
import * as Haptics from "expo-haptics";
import { ApiError } from "@/lib/api-error";

// ── Mutable test state, hoisted above vi.mock factories ──────────────────────
const state = vi.hoisted(() => ({
  // useCoachStream
  startStream: vi.fn(),
  abortStream: vi.fn(),
  onDone: null as ((fullText: string, blocks?: unknown[]) => void) | null,
  onError: null as ((message: string, code?: string) => void) | null,
  streamingContent: "",
  statusText: "",
  isStreaming: false,
  // useChat
  messages: [] as ChatMessage[],
  isMessagesError: false,
  refetchMessages: vi.fn(),
  deleteMutate: vi.fn().mockResolvedValue(undefined),
  // useSpeechToText
  speech: {
    isListening: false,
    transcript: "",
    isFinal: false,
    volume: -2,
    startListening: vi.fn(),
    stopListening: vi.fn(),
  },
  // premium — "coachPro" (mic) stays on the pre-existing `hasVoice` flag;
  // "catalogSave" (add_recipe_to_plan gate) is independent so existing
  // hasVoice-driven tests are unaffected.
  hasVoice: false,
  canSaveCatalog: true,
  // navigation
  navigate: vi.fn(),
  // apiRequest (commitment accept)
  apiRequest: vi.fn().mockResolvedValue(undefined),
  // add_recipe_to_plan: captured from the mocked BlockRenderer's onAction prop
  // so tests can fire an arbitrary action without a canned block.action.
  onAction: null as ((action: Record<string, unknown>) => void) | null,
  // useMealPlanRecipes / useMealPlan
  saveCatalog: vi.fn().mockResolvedValue({ id: 99 }),
  addItem: vi.fn().mockResolvedValue({}),
  mealPlanItems: [] as { plannedDate: string }[],
  // Captures the args CoachChat passed on the most recent useMealPlanItems
  // call — the query itself is mocked, so this is the only observable
  // surface for what CoachChat asked for (start/end window, enabled gate).
  useMealPlanItemsArgs: [] as unknown[],
  // ToastContext / useHaptics
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  hapticsNotification: vi.fn(),
}));

/** Adjust a single premium feature flag for the next render. */
function setPremiumFeatures(overrides: {
  catalogSave?: boolean;
  coachPro?: boolean;
}) {
  if (overrides.catalogSave !== undefined) {
    state.canSaveCatalog = overrides.catalogSave;
  }
  if (overrides.coachPro !== undefined) {
    state.hasVoice = overrides.coachPro;
  }
}

vi.mock("@/hooks/useCoachStream", () => ({
  useCoachStream: (opts: {
    onDone: (fullText: string, blocks?: unknown[]) => void;
    onError: (message: string, code?: string) => void;
  }) => {
    state.onDone = opts.onDone;
    state.onError = opts.onError;
    return {
      startStream: state.startStream,
      abortStream: state.abortStream,
      streamingContent: state.streamingContent,
      statusText: state.statusText,
      isStreaming: state.isStreaming,
    };
  },
}));

vi.mock("@/hooks/useChat", () => ({
  useChatMessages: () => ({
    data: state.messages,
    isError: state.isMessagesError,
    refetch: state.refetchMessages,
  }),
  useDeleteChatMessageForRetry: () => ({ mutateAsync: state.deleteMutate }),
}));

vi.mock("@/hooks/useSpeechToText", () => ({
  useSpeechToText: () => state.speech,
}));

vi.mock("@/hooks/useTTS", () => ({
  useTTS: () => ({
    isSpeaking: false,
    speakingMessageId: null,
    speak: vi.fn(),
    stop: vi.fn(),
  }),
}));

vi.mock("@/hooks/usePremiumFeatures", () => ({
  usePremiumFeature: (feature: string) =>
    feature === "catalogSave" ? state.canSaveCatalog : state.hasVoice,
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: state.navigate }),
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => state.apiRequest(...args),
}));

vi.mock("@/hooks/useMealPlanRecipes", () => ({
  useSaveCatalogRecipe: () => ({
    mutateAsync: state.saveCatalog,
    isPending: false,
  }),
}));

vi.mock("@/hooks/useMealPlan", () => ({
  useMealPlanItems: (...args: unknown[]) => {
    state.useMealPlanItemsArgs = args;
    return { data: state.mealPlanItems };
  },
  useAddMealPlanItem: () => ({
    mutateAsync: state.addItem,
    isPending: false,
  }),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({
    success: state.toastSuccess,
    error: state.toastError,
    info: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: vi.fn(),
    notification: state.hapticsNotification,
    selection: vi.fn(),
  }),
}));

// Thin CoachChatBase double: renders children + a Send button wired to onSend,
// and surfaces inlineBanner / streamingError so the limit/error branches show.
vi.mock("@/components/coach/CoachChatBase", () => ({
  CoachChatBase: ({
    children,
    onSend,
    onChangeText,
    streamingError,
    inlineBanner,
    inputAdornment,
  }: {
    children: React.ReactNode;
    onSend: () => void;
    onChangeText: (t: string) => void;
    streamingError?: string | null;
    inlineBanner?: React.ReactNode;
    inputAdornment?: React.ReactNode;
  }) => (
    <div data-testid="chat-base">
      <button data-testid="send" onClick={() => onSend()}>
        send
      </button>
      <input
        data-testid="text-input"
        onChange={(e) => onChangeText(e.target.value)}
      />
      {streamingError ? (
        <div data-testid="streaming-error">{streamingError}</div>
      ) : null}
      <div data-testid="adornment">{inputAdornment}</div>
      <div data-testid="banner">{inlineBanner}</div>
      {children}
    </div>
  ),
}));

// Thin BlockRenderer double: exposes onAction / onQuickReply / onCommitmentAccept
// so tests can drive CoachChat's block handlers.
vi.mock("@/components/coach/blocks", () => ({
  default: ({
    block,
    onAction,
    onQuickReply,
    onCommitmentAccept,
  }: {
    block: { type: string; [k: string]: unknown };
    onAction?: (action: Record<string, unknown>) => void;
    onQuickReply?: (message: string, blockKey?: string) => void;
    onCommitmentAccept?: (
      id: number | undefined,
      title: string,
      date: string,
    ) => void;
  }) => {
    // Captured so tests can fire an arbitrary action (not just the one fixed
    // block.action a given render was mounted with) via `state.onAction?.(...)`.
    state.onAction = onAction ?? null;
    return (
      <div data-testid={`block-${block.type}`}>
        <button
          data-testid="block-action"
          onClick={() => onAction?.(block.action as Record<string, unknown>)}
        >
          action
        </button>
        <button
          data-testid="block-quick-reply"
          onClick={() => onQuickReply?.("a quick reply", "qk-1")}
        >
          quick-reply
        </button>
        <button
          data-testid="block-commit"
          onClick={() =>
            onCommitmentAccept?.(
              block.notebookEntryId as number | undefined,
              (block.title as string) ?? "",
              (block.followUpDate as string) ?? "",
            )
          }
        >
          commit
        </button>
      </div>
    );
  },
}));

// Thin StreamingBubble double — presence proves the streamingFooter branch.
vi.mock("@/components/coach/StreamingBubble", () => ({
  default: ({
    streamingContent,
    statusText,
  }: {
    streamingContent: string;
    statusText: string;
  }) => (
    <div data-testid="streaming-bubble">
      {streamingContent}
      {statusText}
    </div>
  ),
}));

// Thin ChatBubble double exposing onSpeak (retry-target / optimistic rendering).
vi.mock("@/components/ChatBubble", () => ({
  ChatBubble: ({ role, content }: { role: string; content: string }) => (
    <div data-testid={`bubble-${role}`}>{content}</div>
  ),
}));

vi.mock("@/components/UpgradeModal", () => ({
  UpgradeModal: ({ visible }: { visible: boolean }) =>
    visible ? <div data-testid="upgrade-modal" /> : null,
}));

vi.mock("@/components/coach/CoachMicButton", () => ({
  default: () => <div data-testid="mic-button" />,
}));

function makeMessage(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 1,
    conversationId: 1,
    role: "user",
    content: "hi",
    metadata: null,
    turnKey: null,
    createdAt: new Date("2024-01-01") as unknown as string,
    ...overrides,
  } as ChatMessage;
}

const warmUpHook = {
  sendWarmUp: vi.fn(),
  sendTextWarmUp: vi.fn(),
  getWarmUpId: vi.fn(() => null as string | null),
  reset: vi.fn(),
};

function renderCoachChat(
  props: Partial<React.ComponentProps<typeof CoachChat>> = {},
) {
  return renderComponent(
    <CoachChat
      conversationId={1}
      onCreateConversation={vi.fn().mockResolvedValue(99)}
      isCoachPro={false}
      warmUpHook={warmUpHook}
      {...props}
    />,
  );
}

function resetState() {
  state.startStream = vi.fn();
  state.abortStream = vi.fn();
  state.onDone = null;
  state.onError = null;
  state.streamingContent = "";
  state.statusText = "";
  state.isStreaming = false;
  state.messages = [];
  state.isMessagesError = false;
  state.refetchMessages = vi.fn();
  state.deleteMutate = vi.fn().mockResolvedValue(undefined);
  state.speech = {
    isListening: false,
    transcript: "",
    isFinal: false,
    volume: -2,
    startListening: vi.fn(),
    stopListening: vi.fn(),
  };
  state.hasVoice = false;
  state.canSaveCatalog = true;
  state.navigate = vi.fn();
  state.apiRequest = vi.fn().mockResolvedValue(undefined);
  state.onAction = null;
  state.saveCatalog = vi.fn().mockResolvedValue({ id: 99 });
  state.addItem = vi.fn().mockResolvedValue({});
  state.mealPlanItems = [];
  state.useMealPlanItemsArgs = [];
  state.toastSuccess = vi.fn();
  state.toastError = vi.fn();
  state.hapticsNotification = vi.fn();
  warmUpHook.sendWarmUp.mockClear();
  warmUpHook.sendTextWarmUp.mockClear();
  warmUpHook.reset.mockClear();
  warmUpHook.getWarmUpId.mockReturnValue(null);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetState();
});

// ── handleSend branches ──────────────────────────────────────────────────────
describe("CoachChat — handleSend", () => {
  it("ignores send with empty/whitespace input", () => {
    renderCoachChat({ conversationId: 1 });
    fireEvent.click(screen.getByTestId("send"));
    expect(state.startStream).not.toHaveBeenCalled();
  });

  it("starts a stream with non-empty input when a conversation exists", () => {
    renderCoachChat({ conversationId: 7 });
    fireEvent.change(screen.getByTestId("text-input"), {
      target: { value: "what should I eat" },
    });
    fireEvent.click(screen.getByTestId("send"));
    expect(state.startStream).toHaveBeenCalledWith(7, "what should I eat", {
      warmUpId: null,
    });
  });

  it("does not start a stream while already streaming", () => {
    state.isStreaming = true;
    renderCoachChat({ conversationId: 7 });
    fireEvent.change(screen.getByTestId("text-input"), {
      target: { value: "hello" },
    });
    fireEvent.click(screen.getByTestId("send"));
    expect(state.startStream).not.toHaveBeenCalled();
  });

  it("creates a conversation first when conversationId is null", async () => {
    const onCreateConversation = vi.fn().mockResolvedValue(55);
    renderCoachChat({ conversationId: null, onCreateConversation });
    fireEvent.change(screen.getByTestId("text-input"), {
      target: { value: "new convo" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("send"));
    });
    expect(onCreateConversation).toHaveBeenCalled();
    expect(state.startStream).toHaveBeenCalledWith(55, "new convo", {
      warmUpId: null,
    });
  });

  it("aborts the send when conversation creation fails", async () => {
    const onCreateConversation = vi.fn().mockRejectedValue(new Error("boom"));
    renderCoachChat({ conversationId: null, onCreateConversation });
    fireEvent.change(screen.getByTestId("text-input"), {
      target: { value: "new convo" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("send"));
    });
    expect(state.startStream).not.toHaveBeenCalled();
  });

  it("uses the warm-up id and resets warm-up state when isCoachPro", () => {
    warmUpHook.getWarmUpId.mockReturnValue("warm-123");
    renderCoachChat({ conversationId: 7, isCoachPro: true });
    fireEvent.change(screen.getByTestId("text-input"), {
      target: { value: "pro message" },
    });
    fireEvent.click(screen.getByTestId("send"));
    expect(state.startStream).toHaveBeenCalledWith(7, "pro message", {
      warmUpId: "warm-123",
    });
    expect(warmUpHook.reset).toHaveBeenCalled();
  });
});

// ── handleChangeText warm-up branch ──────────────────────────────────────────
describe("CoachChat — handleChangeText", () => {
  it("sends a text warm-up only when isCoachPro", () => {
    renderCoachChat({ isCoachPro: true });
    fireEvent.change(screen.getByTestId("text-input"), {
      target: { value: "typing" },
    });
    expect(warmUpHook.sendTextWarmUp).toHaveBeenCalledWith("typing");
  });

  it("skips text warm-up when not isCoachPro", () => {
    renderCoachChat({ isCoachPro: false });
    fireEvent.change(screen.getByTestId("text-input"), {
      target: { value: "typing" },
    });
    expect(warmUpHook.sendTextWarmUp).not.toHaveBeenCalled();
  });
});

// ── streamingError branch via onError (non-limit) ────────────────────────────
describe("CoachChat — stream error", () => {
  it("renders static copy (never the raw message) for a non-limit stream error", () => {
    renderCoachChat();
    act(() => {
      // Raw server body must NOT reach the UI — only static copy is rendered.
      state.onError?.("500: server exploded", "INTERNAL_ERROR");
    });
    const banner = screen.getByTestId("streaming-error");
    expect(banner).toBeTruthy();
    expect(banner.textContent).toBe("Something went wrong. Please try again.");
    expect(banner.textContent).not.toContain("server exploded");
  });
});

// ── history-load error branch ────────────────────────────────────────────────
describe("CoachChat — history load error", () => {
  it("shows an error + retry when the history fetch fails on an empty thread", () => {
    state.isMessagesError = true;
    state.messages = [];
    renderCoachChat({ conversationId: 7 });
    expect(screen.getByText(/couldn.t load this conversation/i)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /retry loading conversation/i }),
    ).toBeTruthy();
  });

  it("refetches when the retry button is pressed", () => {
    state.isMessagesError = true;
    state.messages = [];
    renderCoachChat({ conversationId: 7 });
    fireEvent.click(
      screen.getByRole("button", { name: /retry loading conversation/i }),
    );
    expect(state.refetchMessages).toHaveBeenCalledTimes(1);
  });

  it("does not show the history error for a genuinely empty new conversation", () => {
    state.isMessagesError = false;
    state.messages = [];
    renderCoachChat({ conversationId: 7 });
    expect(screen.queryByText(/couldn.t load this conversation/i)).toBeNull();
    expect(
      screen.queryByRole("button", { name: /retry loading conversation/i }),
    ).toBeNull();
  });

  it("does not show the history error when cached messages exist despite an error", () => {
    state.isMessagesError = true;
    state.messages = [makeMessage({ id: 1, role: "user", content: "hi" })];
    renderCoachChat({ conversationId: 7 });
    expect(screen.queryByText(/couldn.t load this conversation/i)).toBeNull();
  });
});

// ── onDone branch ────────────────────────────────────────────────────────────
describe("CoachChat — onDone", () => {
  it("does not throw when stream completes with blocks", () => {
    renderCoachChat({ conversationId: 7 });
    // Start a stream so activeConvIdRef is set, then complete it.
    fireEvent.change(screen.getByTestId("text-input"), {
      target: { value: "do it" },
    });
    fireEvent.click(screen.getByTestId("send"));
    act(() => {
      state.onDone?.("done text", [
        {
          type: "action_card",
          title: "t",
          subtitle: "s",
          actionLabel: "go",
          action: { type: "set_goal", goalType: "calories" },
        },
      ]);
    });
    // streamBlocks now populated → streamingFooter renders even when not streaming.
    expect(screen.getByTestId("streaming-bubble")).toBeTruthy();
  });

  it("handles onDone with no blocks", () => {
    renderCoachChat({ conversationId: 7 });
    act(() => {
      state.onDone?.("done text", []);
    });
    expect(screen.queryByTestId("streaming-bubble")).toBeNull();
  });
});

// ── messageBlocks memo + renderItem ──────────────────────────────────────────
describe("CoachChat — message rendering", () => {
  it("renders assistant message blocks from valid metadata", () => {
    state.messages = [
      makeMessage({ id: 1, role: "user", content: "hi" }),
      makeMessage({
        id: 2,
        role: "assistant",
        content: "here",
        metadata: {
          blocks: [
            {
              type: "action_card",
              title: "Log it",
              subtitle: "now",
              actionLabel: "Log",
              action: {
                type: "log_food",
                description: "oats",
                calories: 100,
                protein: 5,
                carbs: 10,
                fat: 2,
              },
            },
          ],
        } as unknown as ChatMessage["metadata"],
      }),
    ];
    renderCoachChat();
    expect(screen.getByTestId("block-action_card")).toBeTruthy();
  });

  it("ignores messages whose metadata.blocks is not an array", () => {
    state.messages = [
      makeMessage({
        id: 3,
        role: "assistant",
        content: "x",
        metadata: { blocks: "not-array" } as unknown as ChatMessage["metadata"],
      }),
    ];
    renderCoachChat();
    expect(screen.queryByTestId("block-action_card")).toBeNull();
  });

  it("renders an optimistic user bubble after sending", () => {
    renderCoachChat({ conversationId: 7 });
    fireEvent.change(screen.getByTestId("text-input"), {
      target: { value: "optimistic text" },
    });
    fireEvent.click(screen.getByTestId("send"));
    expect(screen.getByText("optimistic text")).toBeTruthy();
  });

  it("renders a retry button for the last assistant message when not streaming", () => {
    state.messages = [
      makeMessage({ id: 1, role: "user", content: "q" }),
      makeMessage({ id: 2, role: "assistant", content: "a" }),
    ];
    renderCoachChat();
    expect(
      screen.getByRole("button", { name: /regenerate response/i }),
    ).toBeTruthy();
  });

  it("does not render a retry button when last message is from the user", () => {
    state.messages = [
      makeMessage({ id: 1, role: "assistant", content: "a" }),
      makeMessage({ id: 2, role: "user", content: "q" }),
    ];
    renderCoachChat();
    expect(
      screen.queryByRole("button", { name: /regenerate response/i }),
    ).toBeNull();
  });
});

// ── handleRetry branches ─────────────────────────────────────────────────────
describe("CoachChat — handleRetry", () => {
  function assistantThenUser() {
    state.messages = [
      makeMessage({ id: 1, role: "user", content: "the question" }),
      makeMessage({ id: 2, role: "assistant", content: "the answer" }),
    ];
  }

  it("deletes both messages and re-sends the last user message on retry", async () => {
    assistantThenUser();
    renderCoachChat({ conversationId: 7 });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /regenerate response/i }),
      );
    });
    expect(state.deleteMutate).toHaveBeenCalledTimes(2);
    expect(state.startStream).toHaveBeenCalledWith(
      7,
      "the question",
      expect.anything(),
    );
  });

  it("surfaces an error and restores snapshot if delete fails", async () => {
    assistantThenUser();
    state.deleteMutate = vi.fn().mockRejectedValue(new Error("net"));
    renderCoachChat({ conversationId: 7 });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /regenerate response/i }),
      );
    });
    expect(screen.getByTestId("streaming-error")).toBeTruthy();
    expect(state.startStream).not.toHaveBeenCalled();
  });

  it("does nothing when there are fewer than two messages", async () => {
    // Single assistant message: retry button shows (last is assistant) but
    // handleRetry guards on messages.length < 2.
    state.messages = [makeMessage({ id: 1, role: "assistant", content: "a" })];
    renderCoachChat({ conversationId: 7 });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /regenerate response/i }),
      );
    });
    expect(state.deleteMutate).not.toHaveBeenCalled();
  });
});

// ── handleBlockAction branches ───────────────────────────────────────────────
describe("CoachChat — handleBlockAction", () => {
  function renderWithBlock(action: Record<string, unknown>) {
    state.messages = [
      makeMessage({
        id: 9,
        role: "assistant",
        content: "with block",
        metadata: {
          blocks: [
            {
              type: "action_card",
              title: "T",
              subtitle: "S",
              actionLabel: "Go",
              action,
            },
          ],
        } as unknown as ChatMessage["metadata"],
      }),
    ];
    renderCoachChat({ conversationId: 7 });
  }

  it("log_food action triggers a send", () => {
    renderWithBlock({
      type: "log_food",
      description: "an apple",
      calories: 95,
      protein: 0,
      carbs: 25,
      fat: 0,
    });
    fireEvent.click(screen.getByTestId("block-action"));
    expect(state.startStream).toHaveBeenCalledWith(
      7,
      "Please log: an apple",
      expect.anything(),
    );
  });

  // Each row: [screen, params-on-block, expected-navigate-args].
  // Some screen branches forward `params` as a 2nd navigate arg (even when
  // undefined); param-less branches call navigate(screen) with no 2nd arg.
  it.each<[string, Record<string, unknown> | undefined, unknown[]]>([
    [
      "NutritionDetail",
      { barcode: "123" },
      ["NutritionDetail", { barcode: "123" }],
    ],
    [
      "FeaturedRecipeDetail",
      { recipeId: 1 },
      ["FeaturedRecipeDetail", { recipeId: 1 }],
    ],
    [
      "RecipeChat",
      { conversationId: 2 },
      ["RecipeChat", { conversationId: 2 }],
    ],
    ["Scan", undefined, ["Scan", undefined]],
    ["RecipeBrowserModal", undefined, ["RecipeBrowserModal", undefined]],
    ["QuickLog", undefined, ["QuickLog"]],
    ["DailyNutritionDetail", undefined, ["DailyNutritionDetail"]],
    ["GoalSetup", undefined, ["GoalSetup"]],
    ["GroceryListsModal", undefined, ["GroceryListsModal"]],
    ["PantryModal", undefined, ["PantryModal"]],
    ["CookbookListModal", undefined, ["CookbookListModal"]],
  ])("navigate action routes to %s", (screenName, params, expectedArgs) => {
    renderWithBlock({ type: "navigate", screen: screenName, params });
    fireEvent.click(screen.getByTestId("block-action"));
    expect(state.navigate).toHaveBeenCalledWith(...expectedArgs);
  });

  it("add_meal_plan navigates to RecipeBrowserModal with parsed plan days", () => {
    renderWithBlock({ type: "add_meal_plan", plan: [] });
    fireEvent.click(screen.getByTestId("block-action"));
    expect(state.navigate).toHaveBeenCalledWith("RecipeBrowserModal", {
      planDays: [],
    });
  });

  it("add_grocery_list navigates to GroceryListsModal", () => {
    renderWithBlock({ type: "add_grocery_list", items: [] });
    fireEvent.click(screen.getByTestId("block-action"));
    expect(state.navigate).toHaveBeenCalledWith("GroceryListsModal");
  });

  it("set_goal navigates to GoalSetup", () => {
    renderWithBlock({ type: "set_goal", goalType: "calories" });
    fireEvent.click(screen.getByTestId("block-action"));
    expect(state.navigate).toHaveBeenCalledWith("GoalSetup");
  });
});

// ── handleQuickReply + handleCommitmentAccept ────────────────────────────────
describe("CoachChat — quick reply & commitment", () => {
  function renderWithCommitment(notebookEntryId?: number) {
    state.messages = [
      makeMessage({
        id: 11,
        role: "assistant",
        content: "commit",
        metadata: {
          blocks: [
            {
              type: "commitment_card",
              title: "Walk daily",
              followUpText: "Did you walk?",
              followUpDate: "2026-06-01",
              ...(notebookEntryId !== undefined ? { notebookEntryId } : {}),
            },
          ],
        } as unknown as ChatMessage["metadata"],
      }),
    ];
    renderCoachChat({ conversationId: 7 });
  }

  it("quick reply triggers a send", () => {
    state.messages = [
      makeMessage({
        id: 12,
        role: "assistant",
        content: "qr",
        metadata: {
          blocks: [{ type: "quick_replies", options: [] }],
        } as unknown as ChatMessage["metadata"],
      }),
    ];
    renderCoachChat({ conversationId: 7 });
    fireEvent.click(screen.getByTestId("block-quick-reply"));
    expect(state.startStream).toHaveBeenCalledWith(
      7,
      "a quick reply",
      expect.anything(),
    );
  });

  it("commitment accept with a notebookEntryId posts to the API", async () => {
    renderWithCommitment(42);
    await act(async () => {
      fireEvent.click(screen.getByTestId("block-commit"));
    });
    expect(state.apiRequest).toHaveBeenCalledWith(
      "POST",
      "/api/chat/commitments/42/accept",
    );
  });

  it("commitment accept without a notebookEntryId skips the API call", async () => {
    renderWithCommitment(undefined);
    await act(async () => {
      fireEvent.click(screen.getByTestId("block-commit"));
    });
    expect(state.apiRequest).not.toHaveBeenCalled();
  });
});

// ── streamingFooter branches ─────────────────────────────────────────────────
describe("CoachChat — streamingFooter", () => {
  it("renders the streaming bubble while streaming", () => {
    state.isStreaming = true;
    state.streamingContent = "partial...";
    renderCoachChat();
    expect(screen.getByTestId("streaming-bubble")).toBeTruthy();
  });

  it("does not render the streaming bubble when idle with no blocks", () => {
    state.isStreaming = false;
    renderCoachChat();
    expect(screen.queryByTestId("streaming-bubble")).toBeNull();
  });
});

// ── mic adornment branch (hasVoice) ──────────────────────────────────────────
describe("CoachChat — mic adornment", () => {
  it("renders the mic button when voice is available", () => {
    state.hasVoice = true;
    renderCoachChat();
    expect(screen.getByTestId("mic-button")).toBeTruthy();
  });

  it("omits the mic button when voice is unavailable", () => {
    state.hasVoice = false;
    renderCoachChat();
    expect(screen.queryByTestId("mic-button")).toBeNull();
  });
});

// ── speech-driven effects ────────────────────────────────────────────────────
describe("CoachChat — speech effects", () => {
  it("auto-sends when speech finalizes", () => {
    state.speech = {
      ...state.speech,
      isFinal: true,
      transcript: "spoken text",
    };
    renderCoachChat({ conversationId: 7 });
    expect(state.startStream).toHaveBeenCalledWith(
      7,
      "spoken text",
      expect.anything(),
    );
  });

  it("sends interim transcript as a warm-up while listening when isCoachPro", () => {
    state.speech = {
      ...state.speech,
      isListening: true,
      transcript: "interim",
    };
    renderCoachChat({ conversationId: 7, isCoachPro: true });
    expect(warmUpHook.sendWarmUp).toHaveBeenCalledWith("interim");
  });
});

// ── initialMessage auto-send ─────────────────────────────────────────────────
describe("CoachChat — initialMessage", () => {
  it("auto-sends an initial message and signals it was sent", () => {
    const onInitialMessageSent = vi.fn();
    renderCoachChat({
      conversationId: 7,
      initialMessage: "auto hello",
      onInitialMessageSent,
    });
    expect(state.startStream).toHaveBeenCalledWith(
      7,
      "auto hello",
      expect.anything(),
    );
    expect(onInitialMessageSent).toHaveBeenCalled();
  });
});

// ── unmount cleanup ──────────────────────────────────────────────────────────
describe("CoachChat — cleanup", () => {
  it("aborts the active stream on unmount", () => {
    const { unmount } = renderCoachChat();
    unmount();
    expect(state.abortStream).toHaveBeenCalled();
  });
});

// ── meal-plan items query: premium gate + window freshness (P3-2026-08-30) ──
// useMealPlanItems is module-mocked here, so these tests can only observe
// what CoachChat PASSES to the hook (start/end window, enabled gate) — never
// whether a network request actually fired. See
// docs/solutions/code-quality/a-test-comment-must-claim-only-what-its-own-harness-can-observe-2026-08-06.md.
describe("CoachChat — meal plan items query", () => {
  it("passes catalogSave as the query's enabled gate when the user is not premium", () => {
    setPremiumFeatures({ catalogSave: false });
    renderCoachChat();
    expect(state.useMealPlanItemsArgs[2]).toBe(false);
  });

  it("passes catalogSave as the query's enabled gate when the user is premium", () => {
    setPremiumFeatures({ catalogSave: true });
    renderCoachChat();
    expect(state.useMealPlanItemsArgs[2]).toBe(true);
  });

  // Mirrors the TZ/fake-timer pattern in
  // MealPlanHomeScreen.test.tsx ("planned_date is keyed to the local
  // calendar day") rather than reading ambient system state — a
  // midnight-rollover test that doesn't control the clock and timezone
  // explicitly would pass by agreeing with whatever the test machine's own
  // clock says.
  describe("window freshness across a date rollover", () => {
    const originalTz = process.env.TZ;

    beforeAll(() => {
      process.env.TZ = "Europe/Berlin";
      vi.useFakeTimers({ toFake: ["Date"] });
    });

    afterAll(() => {
      vi.useRealTimers();
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    });

    it("recomputes the fetch window when the sheet is reopened after midnight, not the window pinned at mount", () => {
      // 20:00 Sep 1 in Berlin (UTC+2 in September) — the mount happens here.
      vi.setSystemTime(new Date("2026-09-01T18:00:00Z"));
      state.messages = [
        makeMessage({
          id: 20,
          role: "assistant",
          content: "here's a recipe",
          metadata: {
            blocks: [
              {
                type: "recipe_card",
                recipe: {
                  title: "Lemon Chicken",
                  calories: 520,
                  protein: 42,
                  prepTime: "25 min",
                  imageUrl: null,
                  recipeId: 715538,
                  source: "spoonacular",
                },
              },
            ],
          } as unknown as ChatMessage["metadata"],
        }),
      ];
      renderCoachChat({ conversationId: 7 });
      // PLAN_SLOT_DAY_COUNT is 7 — a 7-day window starting Sep 1 ends Sep 7.
      expect(state.useMealPlanItemsArgs[0]).toBe("2026-09-01");
      expect(state.useMealPlanItemsArgs[1]).toBe("2026-09-07");

      // Roll the clock past midnight Berlin time — 01:00 Sep 2 local.
      vi.setSystemTime(new Date("2026-09-01T23:00:00Z"));

      // Opening the sheet (a fresh "Add to Plan" tap) is the same trigger
      // PlanSlotPickerSheet itself uses to recompute its own days.
      act(() => {
        state.onAction?.({
          type: "add_recipe_to_plan",
          recipeId: 715538,
          recipeTitle: "Lemon Chicken",
        });
      });

      // The fetched window must start AND end on the new current week (Sep
      // 2 - Sep 8), not the week pinned at mount (Sep 1 - Sep 7) — the
      // todo's stated symptom is specifically that the LAST chip's dot goes
      // missing, i.e. the end of the window, not just its start.
      expect(state.useMealPlanItemsArgs[0]).toBe("2026-09-02");
      expect(state.useMealPlanItemsArgs[1]).toBe("2026-09-08");
    });
  });
});

// ── add_recipe_to_plan (client-local action; never enters blockActionSchema) ─
describe("add_recipe_to_plan", () => {
  // Mounts a real recipe_card block so the mocked BlockRenderer renders and
  // captures its onAction prop onto state.onAction — tests then fire an
  // arbitrary action through it rather than a canned block.action.
  function renderWithRecipeCardBlock() {
    state.messages = [
      makeMessage({
        id: 20,
        role: "assistant",
        content: "here's a recipe",
        metadata: {
          blocks: [
            {
              type: "recipe_card",
              recipe: {
                title: "Lemon Chicken",
                calories: 520,
                protein: 42,
                prepTime: "25 min",
                imageUrl: null,
                recipeId: 715538,
                source: "spoonacular",
              },
            },
          ],
        } as unknown as ChatMessage["metadata"],
      }),
    ];
    renderCoachChat({ conversationId: 7 });
  }

  it("opens the slot picker instead of navigating away", () => {
    renderWithRecipeCardBlock();
    act(() => {
      state.onAction?.({
        type: "add_recipe_to_plan",
        recipeId: 715538,
        recipeTitle: "Lemon Chicken",
      });
    });
    expect(state.navigate).not.toHaveBeenCalled();
    expect(screen.getByText("Lemon Chicken")).toBeTruthy();
  });

  it("saves the catalog recipe then adds the item for the chosen slot", async () => {
    renderWithRecipeCardBlock();
    act(() => {
      state.onAction?.({
        type: "add_recipe_to_plan",
        recipeId: 715538,
        recipeTitle: "Lemon Chicken",
      });
    });
    // Capture the default-selected chip's (today's) own accessible label
    // BEFORE confirming — used below to cross-check the toast's day word
    // without recomputing a weekday from any date math of this test's own.
    const chipLabel =
      screen
        .getAllByRole("button", { name: /day-slot/i })[0]
        .getAttribute("aria-label") ?? "";
    fireEvent.click(screen.getByText("Dinner"));
    fireEvent.click(screen.getByRole("button", { name: /add to plan/i }));

    await waitFor(() => {
      expect(state.saveCatalog).toHaveBeenCalledWith(715538);
      expect(state.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          recipeId: 99,
          mealType: "dinner",
          // plan-slot-picker-utils.ts carries a load-bearing UTC comment on
          // this shape — pin it here (not recompute the expected ISO date,
          // which would duplicate that production logic) so an absent or
          // malformed plannedDate reaching the mutation fails this test.
          plannedDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        }),
      );
    });
    // save must resolve BEFORE the add — the add needs the user-owned recipe id
    expect(state.saveCatalog.mock.invocationCallOrder[0]).toBeLessThan(
      state.addItem.mock.invocationCallOrder[0],
    );

    await waitFor(() => {
      expect(state.toastSuccess).toHaveBeenCalledTimes(1);
    });
    const toastMessage = state.toastSuccess.mock.calls[0][0] as string;
    expect(toastMessage).toMatch(/^Added to [A-Za-z]+ Dinner$/);
    // The discriminator: the toast's day word must be the TAPPED chip's own
    // weekday (sourced from PlanSlotPickerSheet's onConfirm third arg), not
    // a weekday re-derived from `plannedDate` — plannedDate is a UTC-shifted
    // key (see PlanSlotDay.iso's doc-comment) and re-parsing it disagrees
    // with the chip's own label for any UTC-positive host TZ. A shape-only
    // match above would not catch that regression; this cross-check does.
    const dayWord = toastMessage
      .replace(/^Added to /, "")
      .replace(/ Dinner$/, "");
    expect(chipLabel).toContain(dayWord);
  });

  it.each([
    [402, "CATALOG_QUOTA_EXCEEDED"],
    [422, "VALIDATION_ERROR"],
    [404, "NOT_FOUND"],
  ])(
    "closes the sheet with an accurate message on a terminal %i save failure",
    async (status, code) => {
      state.saveCatalog.mockRejectedValueOnce(
        new ApiError(`${status}: failed`, code, status),
      );
      renderWithRecipeCardBlock();
      act(() => {
        state.onAction?.({
          type: "add_recipe_to_plan",
          recipeId: 715538,
          recipeTitle: "Lemon Chicken",
        });
      });
      fireEvent.click(screen.getByText("Dinner"));
      fireEvent.click(screen.getByRole("button", { name: /add to plan/i }));

      await waitFor(() => {
        expect(state.toastError).toHaveBeenCalledTimes(1);
      });
      // Never the generic "please try again" — retrying a 402/422/404 can
      // only reproduce the same failure.
      expect(state.toastError).not.toHaveBeenCalledWith(
        "Couldn't add the recipe to your plan. Please try again.",
      );
      expect(state.hapticsNotification).toHaveBeenCalledWith(
        Haptics.NotificationFeedbackType.Error,
      );
      expect(state.addItem).not.toHaveBeenCalled();
      expect(state.toastSuccess).not.toHaveBeenCalled();

      // The mocked Modal unmounts its children once `visible` goes false
      // (test/mocks/react-native.ts) — a terminal failure must close the
      // sheet, so its contents (including this button) are gone. A
      // regression that keeps the sheet open on a terminal failure leaves
      // this button in the DOM and the query below finds it.
      expect(screen.queryByRole("button", { name: /add to plan/i })).toBeNull();
    },
  );

  it("keeps the sheet open and lets the user retry after a rejected save", async () => {
    // Only overrides the FIRST call — the retry below falls through to the
    // default mockResolvedValue({ id: 99 }) set in beforeEach.
    state.saveCatalog.mockRejectedValueOnce(new Error("network down"));
    renderWithRecipeCardBlock();
    act(() => {
      state.onAction?.({
        type: "add_recipe_to_plan",
        recipeId: 715538,
        recipeTitle: "Lemon Chicken",
      });
    });
    fireEvent.click(screen.getByText("Dinner"));
    fireEvent.click(screen.getByRole("button", { name: /add to plan/i }));

    await waitFor(() => {
      expect(state.toastError).toHaveBeenCalledWith(
        "Couldn't add the recipe to your plan. Please try again.",
      );
    });
    expect(state.hapticsNotification).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Error,
    );
    expect(state.addItem).not.toHaveBeenCalled();
    expect(state.toastSuccess).not.toHaveBeenCalled();

    // The mocked Modal unmounts its children outright once `visible` goes
    // false (test/mocks/react-native.ts), so this also proves the sheet
    // never closed on failure: a regression that moves setPlanTarget(null)
    // from the try into the catch removes this button from the DOM and
    // getByRole below throws.
    const confirmButton = screen.getByRole("button", { name: /add to plan/i });
    fireEvent.click(confirmButton);

    // Pins the finally-based release (not next-open) of isSavingPlanRef —
    // the second confirm must reach saveCatalog rather than silently
    // no-op against a guard still stuck true from the failed first attempt.
    await waitFor(() => {
      expect(state.saveCatalog).toHaveBeenCalledTimes(2);
      expect(state.addItem).toHaveBeenCalledWith(
        expect.objectContaining({ recipeId: 99, mealType: "dinner" }),
      );
    });
  });

  it("shows the upgrade modal and calls neither mutation for a free user", () => {
    setPremiumFeatures({ catalogSave: false });
    renderWithRecipeCardBlock();
    act(() => {
      state.onAction?.({
        type: "add_recipe_to_plan",
        recipeId: 715538,
        recipeTitle: "Lemon Chicken",
      });
    });
    expect(state.saveCatalog).not.toHaveBeenCalled();
    expect(state.addItem).not.toHaveBeenCalled();
    expect(screen.getByTestId("upgrade-modal")).toBeTruthy();
  });

  it("guards against a rapid double-tap firing the save mutation twice", async () => {
    // The sheet's own isSubmitting-based guard reads THIS render's prop, which
    // is still false here (the mocked useSaveCatalogRecipe/useAddMealPlanItem
    // hooks return a static isPending: false — it never flips true) — so if
    // CoachChat relied only on that prop, a second synchronous tap before the
    // mutation settles would double-fire. Hold the save pending to force two
    // taps to land while it's still in flight.
    let resolveSave: ((value: { id: number }) => void) | undefined;
    state.saveCatalog.mockImplementation(
      () =>
        new Promise<{ id: number }>((resolve) => {
          resolveSave = resolve;
        }),
    );
    renderWithRecipeCardBlock();
    act(() => {
      state.onAction?.({
        type: "add_recipe_to_plan",
        recipeId: 715538,
        recipeTitle: "Lemon Chicken",
      });
    });
    fireEvent.click(screen.getByText("Dinner"));
    const confirmButton = screen.getByRole("button", { name: /add to plan/i });

    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);

    expect(state.saveCatalog).toHaveBeenCalledTimes(1);

    // Let the in-flight save resolve so the effect cleanup doesn't warn about
    // a state update outside act().
    await act(async () => {
      resolveSave?.({ id: 99 });
    });
  });
});
