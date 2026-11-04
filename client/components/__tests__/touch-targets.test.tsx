// @vitest-environment jsdom
/**
 * Regression coverage for todos/P2-2026-10-29-touch-targets-per-site-pass.md
 * (audit M-a11y-1): icon-only buttons rely on hitSlop={8} for a 44pt target,
 * but RN clips hitSlop to the parent's bounds (Android) and a slop that
 * reaches a neighbour steals its taps. These buttons must instead be a real
 * 44pt box (minWidth/minHeight 44) with no hitSlop.
 *
 * The shared react-native mock drops Pressable's `style`, so this file wraps
 * Pressable to capture its raw props, keyed by accessibilityLabel.
 */
import React from "react";
import { renderComponent } from "../../../test/utils/render-component";
import { ChatBubble } from "../ChatBubble";
import { ParsedFoodPreview } from "../ParsedFoodPreview";
import { ServingStepperChip } from "../recipe-detail/ServingStepperChip";
import { Toast } from "../Toast";
import { UpgradeModal } from "../UpgradeModal";
import { SheetHeader } from "../sheet/SheetChrome";
import { MealSlotSection } from "../meal-plan/MealSlotSection";
import CoachChat from "../coach/CoachChat";
import { Colors } from "@/constants/theme";

const { captured } = vi.hoisted(() => ({
  captured: {} as Record<string, Record<string, unknown>>,
}));

vi.mock("@/lib/iap/usePurchase", () => ({
  usePurchase: () => ({
    state: { status: "idle" },
    purchase: vi.fn(),
    restore: vi.fn(),
    reset: vi.fn(),
    product: null,
    refreshProduct: vi.fn(),
  }),
}));

// CoachChat: only the hooks it needs, with the history fetch failing so the
// retry button renders. Child components stay real.
vi.mock("@/hooks/useCoachStream", () => ({
  useCoachStream: () => ({
    startStream: vi.fn(),
    abortStream: vi.fn(),
    streamingContent: "",
    statusText: "",
    isStreaming: false,
  }),
}));
vi.mock("@/hooks/useChat", () => ({
  useChatMessages: () => ({ data: [], isError: true, refetch: vi.fn() }),
  useDeleteChatMessageForRetry: () => ({ mutateAsync: vi.fn() }),
  useSaveRecipeFromChat: () => ({ mutateAsync: vi.fn(), isPending: false }),
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
vi.mock("@/hooks/usePlanCheck", () => ({
  usePlanCheck: () => ({ planUnknown: false, recheckPlan: vi.fn() }),
}));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: vi.fn() }),
}));
vi.mock("@/lib/query-client", () => ({ apiRequest: vi.fn() }));
vi.mock("@/hooks/useInspiredSuggestions", () => ({
  useMakeSuggestion: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
  }),
}));
vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: vi.fn(),
    notification: vi.fn(),
    selection: vi.fn(),
  }),
}));
vi.mock("@/hooks/useFavouriteRecipes", () => ({
  useFavouriteRecipeIds: () => ({ data: { ids: [] } }),
  useToggleFavouriteRecipe: () => ({ mutate: vi.fn() }),
  useAddFavouriteRecipe: () => vi.fn(),
}));
vi.mock("@/components/coach/CoachMicButton", () => ({
  default: () => null,
}));

vi.mock("@/hooks/useAccessibility", () => ({
  useAccessibility: () => ({ reducedMotion: false }),
}));

vi.mock("react-native", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-native")>();
  const Capturing = React.forwardRef<unknown, Record<string, unknown>>(
    (props, ref) => {
      const label = props.accessibilityLabel as string | undefined;
      if (label) captured[label] = props;
      return React.createElement(
        actual.Pressable as React.ComponentType<Record<string, unknown>>,
        { ...props, ref },
      );
    },
  );
  Capturing.displayName = "Pressable";
  return { ...actual, Pressable: Capturing };
});

function flatten(style: unknown): Record<string, unknown> {
  if (typeof style === "function") {
    return flatten(
      (style as (s: { pressed: boolean }) => unknown)({ pressed: false }),
    );
  }
  if (Array.isArray(style)) {
    return style.reduce<Record<string, unknown>>(
      (acc, s) => ({ ...acc, ...flatten(s) }),
      {},
    );
  }
  return (style as Record<string, unknown> | null | undefined) ?? {};
}

function expectRealBox(label: string) {
  const props = captured[label];
  expect(props, `no Pressable captured for "${label}"`).toBeDefined();
  expect(props.hitSlop).toBeUndefined();
  const style = flatten(props.style);
  const w = (style.width ?? style.minWidth) as number;
  const h = (style.height ?? style.minHeight) as number;
  expect(w).toBeGreaterThanOrEqual(44);
  expect(h).toBeGreaterThanOrEqual(44);
}

describe("icon-only buttons are a real 44pt box, not hitSlop", () => {
  it("ChatBubble read-aloud button", () => {
    renderComponent(
      <ChatBubble role="assistant" content="Hi" onSpeak={vi.fn()} />,
    );
    expectRealBox("Read aloud");
  });

  it("ParsedFoodPreview remove button", () => {
    renderComponent(
      <ParsedFoodPreview
        items={[
          {
            name: "Apple",
            quantity: 1,
            unit: "each",
            calories: 95,
            protein: 0,
            carbs: 25,
            fat: 0,
            servingSize: null,
          },
        ]}
        onRemoveItem={vi.fn()}
        onLogAll={vi.fn()}
        isLogging={false}
      />,
    );
    expectRealBox("Remove Apple");
  });

  it("ServingStepperChip minus and plus buttons", () => {
    renderComponent(
      <ServingStepperChip
        servingCount={4}
        isAdjusted={false}
        onIncrement={vi.fn()}
        onDecrement={vi.fn()}
        onSetServings={vi.fn()}
      />,
    );
    expectRealBox("Decrease servings");
    expectRealBox("Increase servings");
  });
});

describe("remaining hitSlop={8} sites are a real 44pt box", () => {
  it("Toast action button", () => {
    renderComponent(
      <Toast
        message="Item removed"
        variant="info"
        theme={Colors.light}
        onDismiss={vi.fn()}
        action={{ label: "Undo toast action", onPress: vi.fn() }}
      />,
    );
    expectRealBox("Undo toast action");
  });

  it("UpgradeModal Terms and Privacy links", () => {
    renderComponent(<UpgradeModal visible onClose={vi.fn()} />);
    expectRealBox("Terms of Service");
    expectRealBox("Privacy Policy");
  });

  it("SheetHeader Done button", () => {
    renderComponent(<SheetHeader title="Filters" onDone={vi.fn()} />);
    expectRealBox("Close");
  });

  it("MealSlotSection suggest chip", () => {
    renderComponent(
      <MealSlotSection
        mealType="breakfast"
        items={[]}
        confirmedIds={new Set()}
        onItemPress={vi.fn()}
        onRemoveItem={vi.fn()}
        onAddItem={vi.fn()}
        onSuggest={vi.fn()}
        onConfirmItem={vi.fn()}
        canSuggest
        canConfirm={false}
        isExpanded
        onToggle={vi.fn()}
        sectionSummary={{ itemCount: 0, totalCalories: 0 }}
      />,
    );
    expectRealBox("AI suggest breakfast");
  });

  it("CoachChat history retry button", () => {
    renderComponent(
      <CoachChat
        conversationId={7}
        onCreateConversation={vi.fn()}
        isCoachPro={false}
        warmUpHook={{
          sendWarmUp: vi.fn(),
          sendTextWarmUp: vi.fn(),
          getWarmUpId: vi.fn(() => null),
          reset: vi.fn(),
        }}
      />,
    );
    expectRealBox("Retry loading conversation");
  });
});
