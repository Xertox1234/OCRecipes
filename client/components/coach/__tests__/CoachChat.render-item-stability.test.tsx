// @vitest-environment jsdom
/**
 * Regression test for H3 (2026-09-23 front-end audit,
 * todos/archive/P1-2026-09-23-coach-chat-keystroke-rerenders-every-bubble.md):
 * `handleSend` closed over `inputText` and listed it in its own `useCallback`
 * deps, so every keystroke gave `handleSend` a new identity. `handleRetry`,
 * `handleBlockAction`, and `handleQuickReply` all depend on `handleSend`, and
 * `renderItem` depends on those — so a single keystroke cascaded into a brand
 * new `renderItem` reference, which forces a real (non-mock) FlatList to treat
 * every visible row as changed.
 *
 * This intercepts the `react-native` FlatList export (same pattern as
 * RecipeBrowserScreen.params.test.tsx's SectionList capture) to record the
 * actual `renderItem` prop CoachChat passes, and asserts it is the SAME
 * function reference before and after a keystroke.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import CoachChat from "../CoachChat";

const capturedFlatListProps: { value: Record<string, unknown> | null } = {
  value: null,
};

// Hoisted-once doubles matching each real hook's actual stability profile —
// NOT simply "make everything stable". A mock that's stable when the real
// hook isn't (or vice versa) fails this referential-equality assertion for a
// reason unrelated to the SUT:
//   - useTTS.ts's `stop`/`speak` and useCoachStream.ts's `startStream`/
//     `abortStream` are useCallback-wrapped in the real hooks → stable here.
//   - useNavigation() returns the SAME memoized object across re-renders in
//     real react-navigation → `navigation` below is one shared object, not a
//     fresh `{ navigate }` wrapper per call.
//   - useDeleteChatMessageForRetry() wraps a raw useMutation(...), which
//     really does return a brand-new WRAPPER object every render
//     (`{ ...result, mutate, mutateAsync: result.mutate }`) — but `mutate`/
//     `mutateAsync` themselves are useCallback-stable underneath. Only
//     `deleteChatMessageMutateAsync` is hoisted here; the wrapper object
//     itself is intentionally reconstructed fresh in the mock factory below.
const stable = vi.hoisted(() => ({
  startStream: vi.fn(),
  abortStream: vi.fn(),
  ttsSpeak: vi.fn(),
  ttsStop: vi.fn(),
  // react-navigation's real useNavigation() returns the SAME navigation
  // object across re-renders (it's memoized internally) — CoachChat depends
  // on the whole object (not just `.navigate`) in handleBlockAction's deps,
  // so the mock must return one stable object, not a fresh wrapper per call.
  navigation: { navigate: vi.fn() },
  startListening: vi.fn(),
  stopListening: vi.fn(),
  // The real useMutation() returns a brand-new WRAPPER object every render
  // (`{ ...result, mutate, mutateAsync: result.mutate }`), but `mutate` /
  // `mutateAsync` themselves are useCallback-stable (they close over a
  // useState-memoized MutationObserver instance). CoachChat destructures
  // `mutateAsync` specifically so it only ever depends on the stable inner
  // function, never the unstable wrapper — this hoisted fn reproduces that.
  deleteChatMessageMutateAsync: vi.fn(),
  // TanStack Query's `data` is structural-shared: it keeps the SAME array
  // reference across re-renders when the underlying query result hasn't
  // changed (default `structuralSharing: true`). A mock that returns a
  // fresh `[]` literal per call would falsely break `messageBlocks`'s
  // useMemo (deps: [messages]) — which IS in renderItem's own deps — on
  // every keystroke, for a reason unrelated to this test.
  messages: [] as unknown[],
}));

vi.mock("react-native", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-native")>();
  const FlatList = React.forwardRef<unknown, Record<string, unknown>>(
    (props, _ref) => {
      capturedFlatListProps.value = props;
      return null;
    },
  );
  FlatList.displayName = "FlatList";
  return { ...actual, FlatList };
});

vi.mock("@/hooks/useCoachStream", () => ({
  useCoachStream: () => ({
    startStream: stable.startStream,
    abortStream: stable.abortStream,
    streamingContent: "",
    statusText: "",
    isStreaming: false,
  }),
}));

vi.mock("@/hooks/useChat", () => ({
  useChatMessages: () => ({ data: stable.messages }),
  // Fresh WRAPPER object each call (faithful to real useMutation), but a
  // stable `mutateAsync` inside it — see the `stable` comment above.
  useDeleteChatMessageForRetry: () => ({
    mutateAsync: stable.deleteChatMessageMutateAsync,
  }),
}));

vi.mock("@/hooks/useSpeechToText", () => ({
  useSpeechToText: () => ({
    isListening: false,
    transcript: "",
    isFinal: false,
    volume: -2,
    startListening: stable.startListening,
    stopListening: stable.stopListening,
  }),
}));

vi.mock("@/hooks/useTTS", () => ({
  useTTS: () => ({
    isSpeaking: false,
    speakingMessageId: null,
    speak: stable.ttsSpeak,
    stop: stable.ttsStop,
  }),
}));

vi.mock("@/hooks/usePremiumFeatures", () => ({
  usePremiumFeature: () => false,
}));

// UpgradeModal pulls in usePurchase (IAP) — not needed for this test, and
// unmocked it drags in a native-only import graph the jsdom transform can't
// resolve. Same double as CoachChat.test.tsx.
vi.mock("@/components/UpgradeModal", () => ({
  UpgradeModal: () => null,
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => stable.navigation,
}));

vi.mock("@/hooks/useMealPlanRecipes", () => ({
  useSaveCatalogRecipe: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/useMealPlan", () => ({
  useMealPlanItems: () => ({ data: [] }),
  useAddMealPlanItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: vi.fn(),
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

function renderCoachChat() {
  return renderComponent(
    <CoachChat
      conversationId={1}
      onCreateConversation={vi.fn().mockResolvedValue(1)}
      isCoachPro={false}
      warmUpHook={warmUpHook}
    />,
  );
}

describe("CoachChat — renderItem identity stability across keystrokes (H3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedFlatListProps.value = null;
  });

  it("keeps the FlatList renderItem prop referentially stable when the input text changes", () => {
    renderCoachChat();
    const firstRenderItem = capturedFlatListProps.value?.renderItem;
    expect(typeof firstRenderItem).toBe("function");

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "h" },
    });

    const secondRenderItem = capturedFlatListProps.value?.renderItem;
    expect(secondRenderItem).toBe(firstRenderItem);

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "he" },
    });

    const thirdRenderItem = capturedFlatListProps.value?.renderItem;
    expect(thirdRenderItem).toBe(firstRenderItem);
  });
});
