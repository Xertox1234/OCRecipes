// @vitest-environment jsdom
/**
 * Render-test harness for CoachChat — covers the daily-limit banner / upgrade
 * CTA wiring added by the 2026-05-16 unfinished-features audit (finding H1).
 *
 * Scope: this exercises CoachChat's *wiring* only — a DAILY_LIMIT_REACHED stream
 * error (code-driven, not message-prefix) flips `isAtDailyLimit`, which renders
 * the banner; the banner CTA opens UpgradeModal; a successful `onUpgrade` clears
 * the limit. It does not exercise real network, streaming, or IAP behavior
 * (UpgradeModal is mocked as a thin double).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, screen, fireEvent } from "@testing-library/react";
import * as RN from "react-native";
import { QueryClient } from "@tanstack/react-query";
import { renderComponent } from "../../../../test/utils/render-component";
import CoachChat from "../CoachChat";
import { streamBlockEntranceHoldMs } from "@/constants/animations";

// Mutable container for the onError callback CoachChat passes to useCoachStream,
// so the test can trigger a 429 limit error after render. vi.hoisted is required
// because vi.mock factories are hoisted above imports.
const {
  coachStreamRef,
  messagesState,
  mockImpact,
  speechState,
  mockToastError,
  a11y,
  streamState,
} = vi.hoisted(() => ({
  a11y: { reducedMotion: false, screenReaderEnabled: false },
  streamState: { content: "" },
  coachStreamRef: {
    onError: null as ((message: string, code?: string) => void) | null,
    onDone: null as ((fullText: string, blocks?: unknown[]) => void) | null,
  },
  messagesState: { data: [] as unknown[] },
  mockImpact: vi.fn(),
  speechState: { error: null as string | null },
  mockToastError: vi.fn(),
}));

vi.mock("@/hooks/useCoachStream", () => ({
  useCoachStream: (opts: {
    onError: (message: string, code?: string) => void;
    onDone: (fullText: string, blocks?: unknown[]) => void;
  }) => {
    coachStreamRef.onError = opts.onError;
    coachStreamRef.onDone = opts.onDone;
    return {
      startStream: vi.fn(),
      abortStream: vi.fn(),
      streamingContent: streamState.content,
      statusText: "",
      isStreaming: false,
    };
  },
}));

// Thin UpgradeModal double — keeps the test focused on CoachChat's wiring
// (visible toggling + onUpgrade) instead of pulling in IAP / haptics / timers.
vi.mock("@/components/UpgradeModal", () => ({
  UpgradeModal: ({
    visible,
    onUpgrade,
    onClose,
  }: {
    visible: boolean;
    onUpgrade?: () => void;
    onClose: () => void;
  }) =>
    visible ? (
      <div data-testid="upgrade-modal">
        <button onClick={() => onUpgrade?.()}>mock-upgrade</button>
        <button onClick={onClose}>mock-close</button>
      </div>
    ) : null,
}));

vi.mock("@/hooks/useChat", () => ({
  useChatMessages: () => ({ data: messagesState.data }),
  useDeleteChatMessageForRetry: () => ({ mutateAsync: vi.fn() }),
  useSaveRecipeFromChat: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/hooks/useSpeechToText", () => ({
  useSpeechToText: () => ({
    isListening: false,
    transcript: "",
    isFinal: false,
    volume: -2,
    startListening: vi.fn(),
    stopListening: vi.fn(),
    error: speechState.error,
  }),
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
  usePremiumFeature: () => false,
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: vi.fn() }),
}));

// New CoachChat dependencies (add_recipe_to_plan wiring) — this file only
// exercises the pre-existing daily-limit/upgrade branches, so these are thin
// stubs to satisfy render, not behavior under test here.
vi.mock("@/hooks/useMealPlanRecipes", () => ({
  useSaveCatalogRecipe: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/useMealPlan", () => ({
  useMealPlanItems: () => ({ data: [] }),
  useAddMealPlanItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ success: vi.fn(), error: mockToastError, info: vi.fn() }),
}));

vi.mock("@/hooks/useAccessibility", () => ({
  useAccessibility: () => a11y,
}));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: mockImpact,
    notification: vi.fn(),
    selection: vi.fn(),
  }),
}));

const warmUpHook = {
  sendWarmUp: vi.fn(),
  sendTextWarmUp: vi.fn(),
  getWarmUpId: () => null,
  reset: vi.fn(),
};

function renderCoachChat(
  overrides: { onMessageSent?: () => void; initialMessage?: string } = {},
) {
  return renderComponent(
    <CoachChat
      conversationId={1}
      onCreateConversation={vi.fn().mockResolvedValue(1)}
      isCoachPro={false}
      warmUpHook={warmUpHook}
      {...overrides}
    />,
  );
}

/** Flip CoachChat into the daily-limit state via a DAILY_LIMIT_REACHED error. */
function triggerDailyLimit() {
  act(() => {
    coachStreamRef.onError?.("429: …", "DAILY_LIMIT_REACHED");
  });
}

describe("CoachChat — daily-limit banner / upgrade CTA", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    coachStreamRef.onError = null;
  });

  it("does not render the limit banner before a daily-limit error", () => {
    renderCoachChat();
    expect(screen.queryByText(/reached today.s coaching limit/i)).toBeNull();
    expect(
      screen.queryByRole("button", { name: /upgrade to coach pro/i }),
    ).toBeNull();
  });

  it("does not render the limit banner for a non-limit stream error", () => {
    renderCoachChat();
    act(() => {
      // No DAILY_LIMIT_REACHED code → must not flip the limit banner.
      coachStreamRef.onError?.("500: internal server error", "INTERNAL_ERROR");
    });

    expect(screen.queryByText(/reached today.s coaching limit/i)).toBeNull();
    expect(
      screen.queryByRole("button", { name: /upgrade to coach pro/i }),
    ).toBeNull();
  });

  it("renders the banner with a pressable CTA when isAtDailyLimit is true", () => {
    renderCoachChat();
    triggerDailyLimit();

    expect(screen.getByText(/reached today.s coaching limit/i)).toBeTruthy();
    const cta = screen.getByRole("button", {
      name: /upgrade to coach pro/i,
    });
    expect(cta).toBeTruthy();
    expect(cta.tagName.toLowerCase()).toBe("button");
  });

  it("opens UpgradeModal when the CTA is pressed", () => {
    renderCoachChat();
    triggerDailyLimit();

    expect(screen.queryByTestId("upgrade-modal")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: /upgrade to coach pro/i }),
    );

    expect(screen.getByTestId("upgrade-modal")).toBeTruthy();
  });

  it("clears the limit banner after a successful upgrade", () => {
    renderCoachChat();
    triggerDailyLimit();

    fireEvent.click(
      screen.getByRole("button", { name: /upgrade to coach pro/i }),
    );
    // Successful upgrade — UpgradeModal fires onUpgrade.
    fireEvent.click(screen.getByText("mock-upgrade"));

    expect(screen.queryByText(/reached today.s coaching limit/i)).toBeNull();
    expect(
      screen.queryByRole("button", { name: /upgrade to coach pro/i }),
    ).toBeNull();
  });

  it("keeps the limit banner when the modal is closed without upgrading", () => {
    renderCoachChat();
    triggerDailyLimit();

    fireEvent.click(
      screen.getByRole("button", { name: /upgrade to coach pro/i }),
    );
    // Dismiss without upgrading — UpgradeModal fires onClose only.
    fireEvent.click(screen.getByText("mock-close"));

    expect(screen.queryByTestId("upgrade-modal")).toBeNull();
    expect(screen.getByText(/reached today.s coaching limit/i)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /upgrade to coach pro/i }),
    ).toBeTruthy();
  });
});

/**
 * C1 (2026-06-03 full audit): the daily-limit banner already carries
 * accessibilityLiveRegion="assertive" (Android), so the imperative
 * announceForAccessibility must be gated to iOS — otherwise Android double-announces
 * (TYPE_ANNOUNCEMENT + live region). See docs/rules/accessibility.md.
 */
describe("CoachChat — daily-limit announce gating (C1)", () => {
  const originalPlatformOS = RN.Platform.OS;
  let announceSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    coachStreamRef.onError = null;
    announceSpy = vi.spyOn(RN.AccessibilityInfo, "announceForAccessibility");
  });

  afterEach(() => {
    RN.Platform.OS = originalPlatformOS;
    announceSpy.mockRestore();
  });

  it("announces the limit to VoiceOver on iOS", () => {
    RN.Platform.OS = "ios";
    renderCoachChat();
    triggerDailyLimit();

    expect(announceSpy).toHaveBeenCalledWith("Daily coaching limit reached");
  });

  it("does not announce on Android (the banner's live region handles it)", () => {
    RN.Platform.OS = "android";
    renderCoachChat();
    triggerDailyLimit();

    expect(announceSpy).not.toHaveBeenCalledWith(
      "Daily coaching limit reached",
    );
  });
});

describe("CoachChat — onMessageSent", () => {
  it("does not fire onMessageSent on mount", () => {
    const onMessageSent = vi.fn();
    renderCoachChat({ onMessageSent });

    expect(onMessageSent).not.toHaveBeenCalled();
  });

  it("fires onMessageSent once a send commits", () => {
    const onMessageSent = vi.fn();
    renderCoachChat({ onMessageSent });

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Hello coach" },
    });
    fireEvent.click(screen.getByLabelText("Send message"));

    expect(onMessageSent).toHaveBeenCalledOnce();
  });
});

describe("CoachChat — a finished reply's blocks", () => {
  const quickReplies = {
    type: "quick_replies",
    options: [{ label: "Yes please", message: "Yes, show me more" }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    messagesState.data = [];
  });
  afterEach(() => {
    messagesState.data = [];
  });

  // Positive control: before the saved message lands, the footer shows them.
  it("shows the streamed blocks once the reply finishes", () => {
    renderCoachChat();
    act(() => coachStreamRef.onDone?.("Here you go", [quickReplies]));

    expect(screen.getAllByLabelText("Yes please")).toHaveLength(1);
  });

  // The server saves the same blocks into the message's metadata, so once
  // the refetched message renders them the footer copy must go.
  it("shows them once after the saved message arrives", () => {
    const { rerender } = renderCoachChat();
    act(() => coachStreamRef.onDone?.("Here you go", [quickReplies]));

    messagesState.data = [
      {
        id: 7,
        role: "assistant",
        content: "Here you go",
        metadata: { blocks: [quickReplies] },
        createdAt: new Date().toISOString(),
      },
    ];
    act(() =>
      rerender(
        <CoachChat
          conversationId={1}
          onCreateConversation={vi.fn().mockResolvedValue(1)}
          isCoachPro={false}
          warmUpHook={warmUpHook}
        />,
      ),
    );

    expect(screen.getAllByLabelText("Yes please")).toHaveLength(1);
  });

  /** The refetch lands: the reply is saved with `blocks` in its metadata. */
  function deliverSavedReply(
    rerender: (ui: React.ReactElement) => void,
    blocks: unknown[] | null = [quickReplies],
  ) {
    messagesState.data = [
      {
        id: 7,
        role: "assistant",
        content: "Here you go",
        metadata: blocks ? { blocks } : null,
        createdAt: new Date().toISOString(),
      },
    ];
    act(() =>
      rerender(
        <CoachChat
          conversationId={1}
          onCreateConversation={vi.fn().mockResolvedValue(1)}
          isCoachPro={false}
          warmUpHook={warmUpHook}
        />,
      ),
    );
  }

  describe("hand-over from the live copy to the saved one", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
      a11y.reducedMotion = false;
    });

    // A fast refetch used to swap in the saved copy (which never animates)
    // before the live copy's entrance played, so the chips just appeared.
    // The saved reply holds back its blocks and Regenerate until the
    // entrance has had time to finish.
    it("keeps the live chips while their entrance plays", () => {
      const { rerender } = renderCoachChat();
      act(() => coachStreamRef.onDone?.("Here you go", [quickReplies]));
      deliverSavedReply(rerender);

      expect(screen.getAllByLabelText("Yes please")).toHaveLength(1);
      expect(screen.queryByLabelText("Regenerate response")).toBeNull();
    });

    it("swaps to the saved copy once the entrance is done", () => {
      const { rerender } = renderCoachChat();
      act(() => coachStreamRef.onDone?.("Here you go", [quickReplies]));
      deliverSavedReply(rerender);
      act(() => {
        vi.advanceTimersByTime(streamBlockEntranceHoldMs);
      });

      expect(screen.getAllByLabelText("Yes please")).toHaveLength(1);
      expect(screen.getByLabelText("Regenerate response")).toBeTruthy();
    });

    // No entrance plays under Reduce Motion, so nothing is held.
    it("swaps at once under Reduce Motion", () => {
      a11y.reducedMotion = true;
      const { rerender } = renderCoachChat();
      act(() => coachStreamRef.onDone?.("Here you go", [quickReplies]));
      deliverSavedReply(rerender);

      expect(screen.getAllByLabelText("Yes please")).toHaveLength(1);
      expect(screen.getByLabelText("Regenerate response")).toBeTruthy();
    });

    // A saved reply with no blocks never takes over the footer copy, so
    // holding it would hide Regenerate until the next send.
    it("never holds back a saved reply that has no blocks", () => {
      const { rerender } = renderCoachChat();
      act(() => coachStreamRef.onDone?.("Here you go", [quickReplies]));
      deliverSavedReply(rerender, null);

      expect(screen.getByLabelText("Regenerate response")).toBeTruthy();
    });
  });

  // An earlier reply that already carried blocks must not clear the new
  // reply's footer copy before the new message is saved.
  it("keeps the footer copy while only an older reply is on screen", () => {
    messagesState.data = [
      {
        id: 5,
        role: "assistant",
        content: "Earlier",
        metadata: {
          blocks: [
            {
              type: "quick_replies",
              options: [{ label: "Older", message: "Older reply" }],
            },
          ],
        },
        createdAt: new Date().toISOString(),
      },
    ];
    renderCoachChat();
    act(() => coachStreamRef.onDone?.("Here you go", [quickReplies]));

    expect(screen.getAllByLabelText("Yes please")).toHaveLength(1);
  });
});

describe("CoachChat — voice input errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    speechState.error = null;
  });

  it("stays quiet while voice input has no error", () => {
    renderCoachChat();
    expect(mockToastError).not.toHaveBeenCalled();
  });

  // A denied mic permission used to leave the tap with no response at all.
  it("tells the user when voice input fails", () => {
    speechState.error =
      "Microphone or speech recognition permission not granted.";
    renderCoachChat();

    expect(mockToastError).toHaveBeenCalledWith(
      "Microphone or speech recognition permission not granted.",
    );
  });
});

describe("CoachChat — send haptic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Positive control for the zero below: a tap on send buzzes once.
  it("buzzes once when the user taps send", () => {
    renderCoachChat();

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Hello coach" },
    });
    fireEvent.click(screen.getByLabelText("Send message"));

    expect(mockImpact).toHaveBeenCalledOnce();
  });

  // Programmatic sends (suggestion hand-off, voice, quick replies, retry)
  // pass a string; their own trigger owns any haptic.
  it("does not buzz for a programmatic send", () => {
    const onMessageSent = vi.fn();
    renderCoachChat({ onMessageSent, initialMessage: "Plan my dinner" });

    expect(onMessageSent).toHaveBeenCalledOnce();
    expect(mockImpact).not.toHaveBeenCalled();
  });
});

/**
 * When a stream finished, the question and the streamed text went at once,
 * a refetch before the saved rows replaced them, so for that round trip the
 * list showed the conversation as it was before the turn.
 */
describe("CoachChat — a finished turn stays on screen until it is saved", () => {
  let invalidateSpy: ReturnType<typeof vi.spyOn>;
  let finishRefetch: () => void = () => {};
  beforeEach(() => {
    vi.clearAllMocks();
    messagesState.data = [];
    invalidateSpy = vi
      .spyOn(QueryClient.prototype, "invalidateQueries")
      .mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            finishRefetch = resolve;
          }),
      );
  });
  afterEach(() => {
    invalidateSpy.mockRestore();
    messagesState.data = [];
    streamState.content = "";
  });

  function send(text: string) {
    fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });
    fireEvent.click(screen.getByLabelText("Send message"));
  }

  it("keeps the question and the reply until the refetch lands", async () => {
    renderCoachChat();
    send("Hello coach");
    streamState.content = "Here you go";
    act(() => coachStreamRef.onDone?.("Here you go"));

    expect(screen.queryAllByText("Hello coach")).toHaveLength(1);
    expect(screen.queryAllByText("Here you go")).toHaveLength(1);

    messagesState.data = [
      { id: 6, role: "user", content: "Hello coach", createdAt: "" },
      { id: 7, role: "assistant", content: "Here you go", createdAt: "" },
    ];
    await act(async () => finishRefetch());

    expect(screen.queryAllByText("Hello coach")).toHaveLength(1);
    expect(screen.queryAllByText("Here you go")).toHaveLength(1);
  });

  // The saved rows replace the live ones in the same commit: never both.
  // Counted inside Profiler's onRender, which runs once per commit after the
  // DOM is updated, because the final state alone hides an in-between frame.
  it("never shows the turn twice when the saved rows arrive", () => {
    let mostShown = 0;
    const countEachCommit = () => {
      mostShown = Math.max(
        mostShown,
        screen.queryAllByText("Hello coach").length,
        screen.queryAllByText("Here you go").length,
      );
    };
    const chat = () => (
      <React.Profiler id="chat" onRender={countEachCommit}>
        <CoachChat
          conversationId={1}
          onCreateConversation={vi.fn().mockResolvedValue(1)}
          isCoachPro={false}
          warmUpHook={warmUpHook}
        />
      </React.Profiler>
    );
    const { rerender } = renderComponent(chat());
    send("Hello coach");
    streamState.content = "Here you go";
    act(() => coachStreamRef.onDone?.("Here you go"));

    messagesState.data = [
      { id: 6, role: "user", content: "Hello coach", createdAt: "" },
      { id: 7, role: "assistant", content: "Here you go", createdAt: "" },
    ];
    act(() => rerender(chat()));

    expect(mostShown).toBe(1);
    expect(screen.queryAllByText("Hello coach")).toHaveLength(1);
    expect(screen.queryAllByText("Here you go")).toHaveLength(1);
  });

  it("never clears a question sent while the last one was saving", async () => {
    renderCoachChat();
    send("Hello coach");
    act(() => coachStreamRef.onDone?.("Here you go"));
    const finishFirst = finishRefetch;
    send("Second question");

    await act(async () => finishFirst());

    expect(screen.queryAllByText("Second question")).toHaveLength(1);
  });
});

/**
 * H6: unmounting mid-answer makes the server settle the turn after the client
 * is gone (refund or partial reply). Only `onDone` invalidated before, so the
 * 5-min staleTime served the pre-settle cache on the next view.
 */
describe("CoachChat — unmount marks the conversation stale (H6)", () => {
  // Restored in afterEach so a failed assertion can't leave the prototype
  // spied for later tests in this file.
  let invalidateSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    invalidateSpy = vi.spyOn(QueryClient.prototype, "invalidateQueries");
  });
  afterEach(() => {
    invalidateSpy.mockRestore();
  });

  it("invalidates messages + list without refetching on unmount after a send", () => {
    const { unmount } = renderCoachChat();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Hello coach" },
    });
    fireEvent.click(screen.getByLabelText("Send message"));
    invalidateSpy.mockClear();

    unmount();

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["/api/chat/conversations/1/messages"],
      refetchType: "none",
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["/api/chat/conversations"],
      refetchType: "none",
    });
  });
});
