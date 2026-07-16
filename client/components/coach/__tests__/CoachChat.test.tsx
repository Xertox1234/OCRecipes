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
import { renderComponent } from "../../../../test/utils/render-component";
import CoachChat from "../CoachChat";

// Mutable container for the onError callback CoachChat passes to useCoachStream,
// so the test can trigger a 429 limit error after render. vi.hoisted is required
// because vi.mock factories are hoisted above imports.
const { coachStreamRef } = vi.hoisted(() => ({
  coachStreamRef: {
    onError: null as ((message: string, code?: string) => void) | null,
  },
}));

vi.mock("@/hooks/useCoachStream", () => ({
  useCoachStream: (opts: {
    onError: (message: string, code?: string) => void;
  }) => {
    coachStreamRef.onError = opts.onError;
    return {
      startStream: vi.fn(),
      abortStream: vi.fn(),
      streamingContent: "",
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
  useChatMessages: () => ({ data: [] }),
  useDeleteChatMessageForRetry: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/hooks/useSpeechToText", () => ({
  useSpeechToText: () => ({
    isListening: false,
    transcript: "",
    isFinal: false,
    volume: -2,
    startListening: vi.fn(),
    stopListening: vi.fn(),
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

const warmUpHook = {
  sendWarmUp: vi.fn(),
  sendTextWarmUp: vi.fn(),
  getWarmUpId: () => null,
  reset: vi.fn(),
};

function renderCoachChat(overrides: { onMessageSent?: () => void } = {}) {
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
