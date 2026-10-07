// @vitest-environment jsdom
// Task 14: RecipeChef renders the offer + adjust blocks with the real finder
// components and sends their taps through its existing finder action path.
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import type { ChatMessage } from "@/hooks/useChat";
import RecipeChatScreen from "@/screens/RecipeChatScreen";
import { finderActionSchema } from "@shared/schemas/recipe-finder";

const { chat } = vi.hoisted(() => ({
  chat: {
    messages: [] as unknown[],
    sendMessage: vi.fn(),
    /** The finished reply's live copy, before the saved row lands. */
    pending: null as unknown,
  },
}));

vi.mock("@/hooks/usePendingAssistantBridge", () => ({
  usePendingAssistantBridge: () => chat.pending,
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    goBack: vi.fn(),
    canGoBack: () => true,
    navigate: vi.fn(),
    reset: vi.fn(),
  }),
  useRoute: () => ({ params: { conversationId: 11 } }),
}));
vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
  }),
}));
vi.mock("@/hooks/useChat", () => ({
  useCreateConversation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useChatMessages: () => ({ data: chat.messages }),
  useSendMessage: () => ({
    sendMessage: chat.sendMessage,
    abortStream: vi.fn(),
    streamingContent: "",
    streamingRecipe: null,
    streamingFinder: null,
    streamingStatus: null,
    isStreaming: false,
    streamError: false,
    requestError: null,
  }),
  useSaveRecipeFromChat: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useMarkPendingRecipeTurn: () => vi.fn(),
}));
vi.mock("@/hooks/usePremiumFeatures", () => ({
  usePremiumFeature: () => true,
}));
vi.mock("@/components/UpgradeModal", () => ({ UpgradeModal: () => null }));

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

function message(id: number, content: string, finder: unknown): ChatMessage {
  return {
    id,
    conversationId: 11,
    role: "assistant",
    content,
    metadata: { metadataVersion: 1, finder },
    createdAt: new Date().toISOString(),
  } as ChatMessage;
}

const offerMessage = message(2, `${OFFER}\n\nReply "yes", "search", or "no".`, {
  type: "recipe_offer",
  flow,
});
const adjustMessage = message(
  3,
  'Spaghetti & meatballs — 8 servings, mild, 30-60 minutes.\n\nReply "generate" to make it.',
  {
    type: "recipe_adjust",
    prefill: { servings: 8, spice: "mild", time: "moderate" },
    avoiding: ["peanuts"],
    noted: { dislikes: [] },
    followUps: [{ question: "Beef or pork?", options: ["Beef", "Pork"] }],
    flow: { ...flow, stage: "adjust" },
  },
);

beforeEach(() => {
  chat.sendMessage.mockReset();
  chat.messages = [];
  chat.pending = null;
});

describe("RecipeChef — the adjust card survives the pending → saved swap", () => {
  it("keeps the choices made on the pending card and Generate sends them", () => {
    // The card first renders live in the pending bubble (key "pending-assistant").
    chat.pending = {
      content: "",
      recipe: null,
      finder: (adjustMessage.metadata as { finder: unknown }).finder,
    };
    const { rerender } = renderComponent(<RecipeChatScreen />);
    fireEvent.click(screen.getByRole("button", { name: "More servings" }));
    fireEvent.click(screen.getByRole("button", { name: "More servings" }));
    fireEvent.click(screen.getByRole("radio", { name: "Hot" }));
    expect(screen.getByTestId("adjust-servings").textContent).toBe("10");

    // The refetch lands: the saved row (key = its id) replaces the pending one.
    chat.pending = null;
    chat.messages = [adjustMessage];
    rerender(<RecipeChatScreen />);
    expect(screen.getAllByTestId("adjust-servings")).toHaveLength(1);
    expect(screen.getByTestId("adjust-servings").textContent).toBe("10");
    expect(
      screen.getByRole("radio", { name: "Hot" }).getAttribute("aria-selected"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    const [, , , opts] = chat.sendMessage.mock.calls[0];
    expect(opts.finderAction).toEqual({
      type: "adjust_generate",
      flowId: FLOW,
      settings: { servings: 10, spice: "hot", time: "moderate" },
    });
    expect(finderActionSchema.safeParse(opts.finderAction).success).toBe(true);
  });
});

describe("RecipeChef — offer + adjust", () => {
  it("shows the offer text and sends Yes through the finder action path", () => {
    chat.messages = [offerMessage];
    renderComponent(<RecipeChatScreen />);
    expect(screen.getByText(OFFER)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(chat.sendMessage).toHaveBeenCalledWith("Yes", undefined, 11, {
      finderAction: { type: "offer_yes", flowId: FLOW },
    });
  });

  it("renders the adjust card and Generate sends a schema-valid action", () => {
    chat.messages = [offerMessage, adjustMessage];
    renderComponent(<RecipeChatScreen />);
    expect(screen.getByText("Avoiding")).toBeDefined();
    // The older offer is no longer the latest finder block.
    expect(
      screen.getByRole("button", { name: "Yes" }).getAttribute("aria-disabled"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Pork" }));
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    expect(chat.sendMessage).toHaveBeenCalledTimes(1);
    const [label, , convId, opts] = chat.sendMessage.mock.calls[0];
    expect(label).toBe("Generate");
    expect(convId).toBe(11);
    expect(opts.finderAction).toEqual({
      type: "adjust_generate",
      flowId: FLOW,
      settings: { servings: 8, spice: "mild", time: "moderate" },
      answers: [{ question: "Beef or pork?", answer: "Pork" }],
    });
    expect(finderActionSchema.safeParse(opts.finderAction).success).toBe(true);
  });

  it("still renders old results and questions messages", () => {
    chat.messages = [
      message(4, "No community recipes matched.", {
        type: "recipe_results",
        source: "community",
        items: [],
        actions: ["generate"],
        notice: "no_matches",
        flow: { ...flow, stage: "results" },
      }),
      message(5, "A few quick questions", {
        type: "recipe_questions",
        questions: [{ question: "Diet?", options: ["Vegan", "None"] }],
        flow: { ...flow, stage: "clarifying" },
      }),
    ];
    renderComponent(<RecipeChatScreen />);
    expect(screen.getByText("From the community")).toBeDefined();
    expect(screen.getByText("Diet?")).toBeDefined();
  });

  it("an unknown future block type falls back to the message text", () => {
    chat.messages = [
      message(6, "Here is something new.", {
        type: "recipe_future_thing",
        flow,
      }),
    ];
    renderComponent(<RecipeChatScreen />);
    expect(screen.getByText("Here is something new.")).toBeDefined();
  });
});
