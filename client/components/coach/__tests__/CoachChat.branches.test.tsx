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
import { ApiError } from "@/lib/api-error";
import { SAVED_ITEMS_FULL_MESSAGE } from "@/lib/saved-items-full";

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
  // "catalogSave" (the finder's "Get ideas for you" lock) is independent so
  // existing hasVoice-driven tests are unaffected.
  hasVoice: false,
  canSearchOnline: true,
  // navigation
  navigate: vi.fn(),
  // apiRequest (commitment accept)
  apiRequest: vi.fn().mockResolvedValue(undefined),
  // Captured from the mocked BlockRenderer's onAction prop so tests can fire
  // an arbitrary action without a canned block.action.
  onAction: null as ((action: Record<string, unknown>) => void) | null,
  // Recipe finder: captured from the mocked BlockRenderer's onFinderAction.
  onFinderAction: null as ((a: unknown, label: string) => void) | null,
  // Finder idea cards: captured from the mocked BlockRenderer.
  onOpenFinderItem: null as ((item: unknown) => void) | null,
  onMakeFinderItem: null as ((item: unknown) => void) | null,
  makingFinderItemId: null as number | null | undefined,
  makeSuggestion: vi.fn(),
  saveRecipe: vi.fn().mockResolvedValue({ id: 5 }),
  // ToastContext / useHaptics
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
  hapticsNotification: vi.fn(),
  favouriteIds: [] as { recipeId: number; recipeType: string }[],
  toggleFavourite: vi.fn(),
  addFavourite: vi.fn(),
}));

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
  useSaveRecipeFromChat: () => ({
    mutateAsync: state.saveRecipe,
    isPending: false,
  }),
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
    feature === "catalogSave" ? state.canSearchOnline : state.hasVoice,
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: state.navigate }),
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => state.apiRequest(...args),
}));

vi.mock("@/hooks/useInspiredSuggestions", () => ({
  useMakeSuggestion: () => ({ mutateAsync: state.makeSuggestion }),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({
    success: state.toastSuccess,
    error: state.toastError,
    info: state.toastInfo,
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
    inputText,
    onSend,
    onChangeText,
    streamingError,
    inlineBanner,
    inputAdornment,
    multilineInput,
    submitOnReturn,
  }: {
    children: React.ReactNode;
    inputText?: string;
    onSend: () => void;
    onChangeText: (t: string) => void;
    streamingError?: string | null;
    inlineBanner?: React.ReactNode;
    inputAdornment?: React.ReactNode;
    multilineInput?: boolean;
    submitOnReturn?: boolean;
  }) => (
    <div
      data-testid="chat-base"
      data-multiline-input={String(!!multilineInput)}
      data-submit-on-return={String(!!submitOnReturn)}
    >
      <button data-testid="send" onClick={() => onSend()}>
        send
      </button>
      <input
        data-testid="text-input"
        onChange={(e) => onChangeText(e.target.value)}
      />
      <div data-testid="input-text">{inputText}</div>
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
    onFinderAction,
    onOpenFinderItem,
    onMakeFinderItem,
    makingFinderItemId,
    isActive,
  }: {
    block: { type: string; [k: string]: unknown };
    onFinderAction?: (a: unknown, label: string) => void;
    onOpenFinderItem?: (item: unknown) => void;
    onMakeFinderItem?: (item: unknown) => void;
    makingFinderItemId?: number | null;
    isActive?: boolean;
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
    state.onFinderAction = onFinderAction ?? null;
    state.onOpenFinderItem = onOpenFinderItem ?? null;
    state.onMakeFinderItem = onMakeFinderItem ?? null;
    state.makingFinderItemId = makingFinderItemId;
    return (
      <div data-testid={`block-${block.type}`} data-active={String(isActive)}>
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
    streamBlocks,
  }: {
    streamingContent: string;
    statusText: string;
    streamBlocks: unknown[];
  }) => (
    <div
      data-testid="streaming-bubble"
      data-blocks={String(streamBlocks.length)}
    >
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

vi.mock("@/components/recipe-chat/RecipeCard", () => ({
  RecipeCard: ({
    recipe,
    onSave,
    isSaved,
    isFavourited,
    onFavourite,
  }: {
    recipe: { title: string };
    onSave?: () => void;
    isSaved?: boolean;
    isFavourited?: boolean;
    onFavourite?: () => void;
  }) => (
    <>
      <button data-testid="generated-card" onClick={onSave}>
        {`${recipe.title}${isSaved ? " saved" : ""}`}
      </button>
      {onFavourite ? (
        <button data-testid="generated-heart" onClick={onFavourite}>
          {isFavourited ? "favourited" : "not favourited"}
        </button>
      ) : null}
    </>
  ),
}));

vi.mock("@/hooks/useFavouriteRecipes", () => ({
  useFavouriteRecipeIds: () => ({ data: { ids: state.favouriteIds } }),
  useToggleFavouriteRecipe: () => ({ mutate: state.toggleFavourite }),
  useAddFavouriteRecipe: () => state.addFavourite,
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
  state.canSearchOnline = true;
  state.navigate = vi.fn();
  state.apiRequest = vi.fn().mockResolvedValue(undefined);
  state.onAction = null;
  state.onFinderAction = null;
  state.saveRecipe = vi.fn().mockResolvedValue({ id: 5 });
  state.onOpenFinderItem = null;
  state.onMakeFinderItem = null;
  state.makingFinderItemId = undefined;
  state.makeSuggestion = vi.fn();
  state.toastSuccess = vi.fn();
  state.toastError = vi.fn();
  state.toastInfo = vi.fn();
  state.favouriteIds = [];
  state.toggleFavourite = vi.fn();
  state.addFavourite = vi.fn();
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

  it("aborts the send when conversation creation fails, restores the typed text, and shows a visible error", async () => {
    const onCreateConversation = vi.fn().mockRejectedValue(new Error("boom"));
    renderCoachChat({ conversationId: null, onCreateConversation });
    fireEvent.change(screen.getByTestId("text-input"), {
      target: { value: "new convo" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("send"));
    });
    expect(state.startStream).not.toHaveBeenCalled();
    // The optimistic bubble/input clear must not eat the user's message —
    // the typed text comes back so they can retry without retyping it.
    expect(screen.getByTestId("input-text").textContent).toBe("new convo");
    // A bare catch that only clears the optimistic bubble leaves the user
    // with no explanation at all — this must surface visibly.
    expect(screen.getByTestId("streaming-error").textContent).toBe(
      "Couldn't start the conversation. Please try again.",
    );
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
// iOS offered no Paste in the Coach Pro input's long-press menu while
// RecipeChef's multiline input did (user report on device, 2026-09-30). Coach
// Pro now uses a multiline input like RecipeChef and the Coach overlay, and
// Return still sends, as it did single-line.
describe("CoachChat — input", () => {
  it("is multiline and Return still sends", () => {
    renderCoachChat({ conversationId: 7 });
    const base = screen.getByTestId("chat-base");
    expect(base.getAttribute("data-multiline-input")).toBe("true");
    expect(base.getAttribute("data-submit-on-return")).toBe("true");
  });
});

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
    ["RecipeBrowserModal", undefined, ["RecipeBrowser", undefined]],
    ["QuickLog", undefined, ["QuickLog"]],
    ["DailyNutritionDetail", undefined, ["DailyNutritionDetail"]],
    ["GoalSetup", undefined, ["GoalSetup"]],
    // The AI's "*Modal" screen names open the Coach-stack routes.
    ["GroceryListsModal", undefined, ["GroceryLists"]],
    ["PantryModal", undefined, ["Pantry"]],
    ["CookbookListModal", undefined, ["CookbookList"]],
  ])("navigate action routes to %s", (screenName, params, expectedArgs) => {
    renderWithBlock({ type: "navigate", screen: screenName, params });
    fireEvent.click(screen.getByTestId("block-action"));
    expect(state.navigate).toHaveBeenCalledWith(...expectedArgs);
  });

  it("add_meal_plan navigates to RecipeBrowser with parsed plan days", () => {
    renderWithBlock({ type: "add_meal_plan", plan: [] });
    fireEvent.click(screen.getByTestId("block-action"));
    expect(state.navigate).toHaveBeenCalledWith("RecipeBrowser", {
      planDays: [],
    });
  });

  it("add_grocery_list navigates to GroceryLists", () => {
    renderWithBlock({ type: "add_grocery_list", items: [] });
    fireEvent.click(screen.getByTestId("block-action"));
    expect(state.navigate).toHaveBeenCalledWith("GroceryLists");
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

describe("CoachChat — recipe finder", () => {
  const FLOW = "11111111-1111-4111-8111-111111111111";
  const finderBlock = {
    type: "recipe_results",
    source: "community",
    items: [],
    actions: ["generate"],
    notice: "no_matches",
    flow: {
      flowId: FLOW,
      stage: "results",
      request: "x",
      query: { q: "x" },
      round: 0,
      shownIds: [],
    },
  };
  const recipe = {
    title: "Chicken Curry",
    description: "d",
    difficulty: "Easy",
    timeEstimate: "30 min",
    servings: 2,
    ingredients: [],
    instructions: ["cook"],
    dietTags: [],
  };

  it("a finder button sends a finder action with its label as the message", () => {
    state.messages = [
      makeMessage({
        id: 2,
        role: "assistant",
        content: "No community recipes matched.",
        metadata: { blocks: [finderBlock] },
      }),
    ];
    renderCoachChat({ conversationId: 1 });
    act(() => {
      state.onFinderAction?.({ type: "generate", flowId: FLOW }, "Generate");
    });
    expect(state.startStream).toHaveBeenCalledWith(1, "Generate", {
      finderAction: { type: "generate", flowId: FLOW },
    });
  });

  it("only the latest assistant message's finder block is active", () => {
    state.messages = [
      makeMessage({
        id: 2,
        role: "assistant",
        content: "a",
        metadata: { blocks: [finderBlock] },
      }),
      makeMessage({ id: 3, role: "user", content: "Generate" }),
      makeMessage({
        id: 4,
        role: "assistant",
        content: "b",
        metadata: {
          blocks: [
            {
              ...finderBlock,
              flow: {
                ...finderBlock.flow,
                flowId: "22222222-2222-4222-8222-222222222222",
              },
            },
          ],
        },
      }),
    ];
    renderCoachChat({ conversationId: 1 });
    const actives = screen
      .getAllByTestId("block-recipe_results")
      .map((el) => el.getAttribute("data-active"));
    expect(actives).toEqual(["false", "true"]);
  });

  // Regenerate re-sends the last user text with no finderAction. After a
  // "Search Spoonacular" tap that text is the button label, and the server
  // reads it as a typed refinement: a community search for "<request>.
  // Search Spoonacular". The finder message carries its own next steps.
  it.each([
    ["a results list", finderBlock],
    [
      "a clarifying-questions block",
      {
        type: "recipe_questions",
        questions: [{ question: "How much time?", options: ["Quick", "Any"] }],
        flow: { ...finderBlock.flow, stage: "clarifying" },
      },
    ],
  ])("shows no Regenerate under %s", (_label, block) => {
    state.messages = [
      makeMessage({ id: 1, role: "user", content: "Search Spoonacular" }),
      makeMessage({
        id: 2,
        role: "assistant",
        content: "Here are 3 Spoonacular recipes: …",
        metadata: { blocks: [block] },
      }),
    ];
    renderCoachChat({ conversationId: 1 });
    expect(
      screen.queryByRole("button", { name: /regenerate response/i }),
    ).toBeNull();
  });

  it("hides a finder message's plain-text fallback", () => {
    state.messages = [
      makeMessage({
        id: 2,
        role: "assistant",
        content: "Here are 3 community recipes: …",
        metadata: { blocks: [finderBlock] },
      }),
    ];
    renderCoachChat({ conversationId: 1 });
    expect(screen.queryByText("Here are 3 community recipes: …")).toBeNull();
  });

  it("renders a generated recipe from top-level metadata and saves it via save-recipe", async () => {
    state.messages = [
      makeMessage({
        id: 9,
        role: "assistant",
        content: "Here's a curry!",
        metadata: {
          metadataVersion: 1,
          recipe,
          allergenWarning: null,
          imageUrl: null,
        },
      }),
    ];
    renderCoachChat({ conversationId: 1 });
    fireEvent.click(screen.getByTestId("generated-card"));
    await waitFor(() =>
      expect(state.saveRecipe).toHaveBeenCalledWith({
        conversationId: 1,
        messageId: 9,
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("generated-card").textContent).toBe(
        "Chicken Curry saved",
      ),
    );
  });

  it("the heart on an unsaved generated recipe saves it, then favourites the saved copy", async () => {
    state.saveRecipe = vi
      .fn()
      .mockResolvedValue({ id: 5, savedItemStatus: "linked" });
    state.messages = [
      makeMessage({
        id: 9,
        role: "assistant",
        content: "Here's a curry!",
        metadata: {
          metadataVersion: 1,
          recipe,
          allergenWarning: null,
          imageUrl: null,
        },
      }),
    ];
    renderCoachChat({ conversationId: 1 });
    fireEvent.click(screen.getByTestId("generated-heart"));

    await waitFor(() =>
      expect(state.addFavourite).toHaveBeenCalledWith({
        recipeId: 5,
        recipeType: "community",
      }),
    );
    expect(state.saveRecipe).toHaveBeenCalledWith({
      conversationId: 1,
      messageId: 9,
    });
    expect(state.toggleFavourite).not.toHaveBeenCalled();
  });

  it("a generated recipe saved earlier reads as saved, and its heart toggles that copy", () => {
    state.favouriteIds = [{ recipeId: 77, recipeType: "community" }];
    state.messages = [
      makeMessage({
        id: 9,
        role: "assistant",
        content: "Here's a curry!",
        metadata: {
          metadataVersion: 1,
          recipe,
          allergenWarning: null,
          imageUrl: null,
          savedRecipeId: 77,
        },
      }),
    ];
    renderCoachChat({ conversationId: 1 });

    expect(screen.getByTestId("generated-card").textContent).toBe(
      "Chicken Curry saved",
    );
    expect(screen.getByTestId("generated-heart").textContent).toBe(
      "favourited",
    );
    fireEvent.click(screen.getByTestId("generated-heart"));
    expect(state.toggleFavourite).toHaveBeenCalledWith({
      recipeId: 77,
      recipeType: "community",
    });
    expect(state.saveRecipe).not.toHaveBeenCalled();
  });

  it("a save that finds Saved Items full says the recipe isn't listed there", async () => {
    state.saveRecipe = vi
      .fn()
      .mockResolvedValue({ id: 5, savedItemStatus: "limit_reached" });
    state.messages = [
      makeMessage({
        id: 9,
        role: "assistant",
        content: "Here's a curry!",
        metadata: {
          metadataVersion: 1,
          recipe,
          allergenWarning: null,
          imageUrl: null,
        },
      }),
    ];
    renderCoachChat({ conversationId: 1 });
    fireEvent.click(screen.getByTestId("generated-card"));

    await waitFor(() =>
      expect(state.toastInfo).toHaveBeenCalledWith(SAVED_ITEMS_FULL_MESSAGE),
    );
    expect(state.toastSuccess).not.toHaveBeenCalled();
  });

  it("drops finder blocks from the live stream footer (the refetched message renders them)", () => {
    renderCoachChat({ conversationId: 1 });
    act(() => {
      state.onDone?.("", [finderBlock, { type: "quick_replies", options: [] }]);
    });
    expect(
      screen.getByTestId("streaming-bubble").getAttribute("data-blocks"),
    ).toBe("1");
  });

  describe("idea cards (Make this mine)", () => {
    const idea = {
      id: 44,
      source: "inspired",
      title: "Smoky Chickpea Tacos",
      imageUrl: null,
      readyInMinutes: 25,
      calories: null,
    };
    const ideasBlock = { ...finderBlock, source: "inspired", items: [idea] };

    function renderWithIdeas() {
      state.messages = [
        makeMessage({
          id: 2,
          role: "assistant",
          content: "Here are ideas for you:",
          metadata: { blocks: [ideasBlock] },
        }),
      ];
      renderCoachChat({ conversationId: 1 });
    }

    it("makes the recipe, then opens it as a community recipe", async () => {
      state.makeSuggestion = vi.fn().mockResolvedValue({ recipeId: 901 });
      renderWithIdeas();
      act(() => {
        state.onMakeFinderItem?.(idea);
      });
      expect(state.makingFinderItemId).toBe(44);
      expect(state.makeSuggestion).toHaveBeenCalledWith(44);
      await waitFor(() =>
        expect(state.navigate).toHaveBeenCalledWith("FeaturedRecipeDetail", {
          recipeId: 901,
          recipeType: "community",
        }),
      );
      await waitFor(() => expect(state.makingFinderItemId).toBeNull());
    });

    it("ignores a second card's tap while one is being made", () => {
      state.makeSuggestion = vi.fn(() => new Promise(() => {}));
      renderWithIdeas();
      act(() => {
        state.onMakeFinderItem?.(idea);
      });
      act(() => {
        state.onMakeFinderItem?.({ ...idea, id: 45 });
      });
      expect(state.makeSuggestion).toHaveBeenCalledTimes(1);
    });

    it.each([
      [429, "You've reached today's recipe limit."],
      [410, "These ideas expired — search again."],
      [500, "Couldn't make this recipe. Try again."],
    ])(
      "a %i make failure toasts its copy and frees the card",
      async (status, copy) => {
        state.makeSuggestion = vi
          .fn()
          .mockRejectedValue(
            new ApiError(`${status}: failed`, undefined, status),
          );
        renderWithIdeas();
        act(() => {
          state.onMakeFinderItem?.(idea);
        });
        await waitFor(() =>
          expect(state.toastError).toHaveBeenCalledWith(copy),
        );
        expect(state.navigate).not.toHaveBeenCalled();
        await waitFor(() => expect(state.makingFinderItemId).toBeNull());
      },
    );

    it("an idea row never opens a detail screen", () => {
      renderWithIdeas();
      act(() => {
        state.onOpenFinderItem?.(idea);
      });
      expect(state.navigate).not.toHaveBeenCalled();
    });
  });
});
