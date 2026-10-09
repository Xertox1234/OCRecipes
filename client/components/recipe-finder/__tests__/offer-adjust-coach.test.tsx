// @vitest-environment jsdom
// Task 14: Coach Pro renders the offer + adjust blocks with the real finder
// components and sends their taps through its existing finder action path.
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import * as Haptics from "expo-haptics";
import CoachChat from "@/components/coach/CoachChat";
import { finderActionSchema } from "@shared/schemas/recipe-finder";

const { chat } = vi.hoisted(() => ({
  chat: { messages: [] as unknown[], startStream: vi.fn() },
}));

vi.mock("@/hooks/useCoachStream", () => ({
  useCoachStream: () => ({
    startStream: chat.startStream,
    abortStream: vi.fn(),
    streamingContent: "",
    statusText: "",
    isStreaming: false,
  }),
}));
vi.mock("@/components/UpgradeModal", () => ({ UpgradeModal: () => null }));
vi.mock("@/hooks/useChat", () => ({
  useChatMessages: () => ({ data: chat.messages }),
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
    error: null,
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
  usePremiumFeature: () => true,
}));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: vi.fn() }),
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

const warmUpHook = {
  sendWarmUp: vi.fn(),
  sendTextWarmUp: vi.fn(),
  getWarmUpId: () => null,
  reset: vi.fn(),
};

function renderCoach() {
  return renderComponent(
    <CoachChat
      conversationId={1}
      onCreateConversation={vi.fn().mockResolvedValue(1)}
      isCoachPro
      warmUpHook={warmUpHook}
    />,
  );
}

const FLOW = "00000000-0000-4000-8000-000000000000";
const OFFER =
  "I can make this into a recipe right here in the chat. Want me to get started?";
const flow = {
  flowId: FLOW,
  stage: "offer",
  request: "spaghetti and meatballs",
  query: { q: "spaghetti and meatballs" },
  round: 0,
  shownIds: [],
  dish: "Spaghetti & meatballs",
};

function message(id: number, content: string, blocks: unknown[]) {
  return {
    id,
    role: "assistant",
    content,
    metadata: { blocks },
    createdAt: new Date().toISOString(),
  };
}

const offerMessage = message(2, OFFER, [{ type: "recipe_offer", flow }]);
const adjustMessage = message(
  3,
  'Spaghetti & meatballs — 8 servings, mild, 30-60 minutes.\n\nReply "generate" to make it.',
  [
    {
      type: "recipe_adjust",
      prefill: { servings: 8, spice: "mild", time: "moderate" },
      avoiding: [],
      noted: { dietType: "vegetarian", dislikes: [] },
      followUps: [],
      flow: { ...flow, stage: "adjust" },
    },
  ],
);

beforeEach(() => {
  chat.startStream.mockReset();
  chat.messages = [];
});

describe("Coach — offer + adjust", () => {
  it("shows the offer text and sends Search through the finder action path", () => {
    chat.messages = [offerMessage];
    renderCoach();
    expect(screen.getByText(OFFER)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(chat.startStream).toHaveBeenCalledWith(1, "Search", {
      finderAction: { type: "offer_search", flowId: FLOW },
    });
  });

  it("renders the adjust card and Generate sends a schema-valid action", () => {
    chat.messages = [offerMessage, adjustMessage];
    renderCoach();
    expect(screen.getByText("Vegetarian")).toBeDefined();
    expect(
      screen.getByRole("button", { name: "No" }).getAttribute("aria-disabled"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Hot" }));
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    expect(chat.startStream).toHaveBeenCalledTimes(1);
    const [convId, label, opts] = chat.startStream.mock.calls[0];
    expect(convId).toBe(1);
    expect(label).toBe("Generate: 8 servings · hot · 30-60 minutes");
    expect(opts.finderAction).toEqual({
      type: "adjust_generate",
      flowId: FLOW,
      settings: { servings: 8, spice: "hot", time: "moderate" },
    });
    expect(finderActionSchema.safeParse(opts.finderAction).success).toBe(true);
  });

  it("Cancel sends adjust_cancel", () => {
    chat.messages = [adjustMessage];
    renderCoach();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(chat.startStream).toHaveBeenCalledWith(1, "Cancel", {
      finderAction: { type: "adjust_cancel", flowId: FLOW },
    });
  });

  it("still renders old results and questions messages", () => {
    chat.messages = [
      message(4, "No community recipes matched.", [
        {
          type: "recipe_results",
          source: "community",
          items: [],
          actions: ["generate"],
          notice: "no_matches",
          flow: { ...flow, stage: "results" },
        },
      ]),
      message(5, "A few quick questions", [
        {
          type: "recipe_questions",
          questions: [{ question: "Diet?", options: ["Vegan", "None"] }],
          flow: { ...flow, stage: "clarifying" },
        },
      ]),
    ];
    renderCoach();
    expect(screen.getByText("From the community")).toBeDefined();
    expect(screen.getByText("Diet?")).toBeDefined();
  });

  it("an unknown future block type falls back to the message text", () => {
    chat.messages = [
      message(6, "Here is something new.", [
        { type: "recipe_future_thing", flow },
      ]),
    ];
    renderCoach();
    expect(screen.getByText("Here is something new.")).toBeDefined();
  });
});

describe("Coach — finder tap haptic", () => {
  it("a finder tap buzzes once, like RecipeChef's", () => {
    chat.messages = [offerMessage];
    renderCoach();
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.impactAsync).toHaveBeenCalledWith(
      Haptics.ImpactFeedbackStyle.Light,
    );
  });
});
