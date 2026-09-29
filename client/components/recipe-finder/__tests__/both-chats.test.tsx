// @vitest-environment jsdom
// Spec §5/§7, D1: RecipeChef and Coach Pro must render a finder block with the
// SAME component. The double is keyed on the one module both chats import.
import React from "react";
import { cleanup, screen } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import type { ChatMessage } from "@/hooks/useChat";
import type { CoachBlock } from "@shared/schemas/coach-blocks";
import RecipeChatScreen from "@/screens/RecipeChatScreen";
import BlockRenderer from "@/components/coach/blocks";

const { finderRenders, finderMessage, finderBlock } = vi.hoisted(() => {
  const block = {
    type: "recipe_results",
    source: "community",
    items: [],
    actions: ["generate"],
    notice: "no_matches",
    flow: {
      flowId: "00000000-0000-4000-8000-000000000000",
      stage: "results",
      request: "x",
      query: { q: "x" },
      round: 0,
      shownIds: [],
    },
  };
  return {
    finderRenders: [] as string[],
    finderBlock: block,
    finderMessage: {
      id: 2,
      conversationId: 11,
      role: "assistant",
      content: "No community recipes matched.",
      metadata: { metadataVersion: 1, finder: block },
      createdAt: new Date().toISOString(),
    } as ChatMessage,
  };
});

vi.mock("@/components/recipe-finder/RecipeFinderMessage", () => ({
  RecipeFinderMessage: ({ block }: { block: { type: string } }) => {
    finderRenders.push(block.type);
    return <div data-testid="shared-finder" />;
  },
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
vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: vi.fn(),
    notification: vi.fn(),
    selection: vi.fn(),
    disabled: false,
  }),
}));
vi.mock("@/hooks/useChat", () => ({
  useCreateConversation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useChatMessages: () => ({ data: [finderMessage] }),
  useSendMessage: () => ({
    sendMessage: vi.fn(),
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
}));
vi.mock("@/hooks/usePremiumFeatures", () => ({
  usePremiumFeature: () => true,
}));
vi.mock("@/components/UpgradeModal", () => ({ UpgradeModal: () => null }));

describe("recipe finder — one component for both chats", () => {
  it("RecipeChef (message metadata) and Coach (block) both render RecipeFinderMessage", () => {
    renderComponent(<RecipeChatScreen />);
    expect(screen.getAllByTestId("shared-finder")).toHaveLength(1);
    cleanup();
    renderComponent(
      <BlockRenderer block={finderBlock as CoachBlock} isActive />,
    );
    expect(screen.getAllByTestId("shared-finder")).toHaveLength(1);
    expect(finderRenders.filter((t) => t === "recipe_results")).toHaveLength(2);
  });
});
