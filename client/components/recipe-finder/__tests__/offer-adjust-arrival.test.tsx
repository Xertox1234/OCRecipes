// @vitest-environment jsdom
//
// A new live offer or adjust card is announced to screen readers once: not
// again when its row remounts (a FlatList row scrolled out and back, or
// RecipeChef's pending bubble replaced by the saved row), and never for an
// old, inert card. Driven through RecipeFinderMessage so the prop threading
// from both chats is covered too.
import React from "react";
import * as RN from "react-native";
import { renderComponent } from "../../../../test/utils/render-component";
import { RecipeFinderMessage } from "../RecipeFinderMessage";
import type {
  RecipeAdjustBlock,
  RecipeOfferBlock,
  RecipeQuestionsBlock,
  RecipeResultsBlock,
} from "@shared/schemas/recipe-finder";

// The "once" record outlives a mount on purpose, so every test gets its own
// flow (flowIds are server-minted and unique per flow).
let flowSeq = 0;
function nextFlowId(): string {
  flowSeq += 1;
  return `00000000-0000-4000-8000-${String(flowSeq).padStart(12, "0")}`;
}

function flow(
  flowId: string,
  stage: "offer" | "adjust" | "clarifying" | "results",
) {
  return {
    flowId,
    stage,
    request: "spaghetti and meatballs for 8",
    query: { q: "spaghetti and meatballs" },
    round: 0 as const,
    shownIds: [],
    dish: "Spaghetti & meatballs",
  };
}

function offerBlock(flowId: string): RecipeOfferBlock {
  return { type: "recipe_offer", flow: flow(flowId, "offer") };
}

function adjustBlock(flowId: string): RecipeAdjustBlock {
  return {
    type: "recipe_adjust",
    prefill: { servings: 8, spice: "mild", time: "moderate" },
    avoiding: [],
    noted: { dislikes: [] },
    followUps: [],
    flow: flow(flowId, "adjust"),
  };
}

// Coach chat audit 2026-11-24 L9: the questions card had no arrival
// announcement. L11: the results list kept its "once" record per mount, so
// a remount announced it again.
function questionsBlock(flowId: string): RecipeQuestionsBlock {
  return {
    type: "recipe_questions",
    questions: [{ question: "How much time?", options: ["Quick", "Slow"] }],
    flow: flow(flowId, "clarifying"),
  };
}

function resultsBlock(flowId: string): RecipeResultsBlock {
  return {
    type: "recipe_results",
    source: "community",
    items: [
      {
        id: 12,
        source: "community",
        title: "Quinoa Salad",
        imageUrl: null,
        readyInMinutes: 20,
        calories: 350,
      },
    ],
    actions: ["generate"],
    notice: null,
    flow: flow(flowId, "results"),
  };
}

function renderCard(
  block: React.ComponentProps<typeof RecipeFinderMessage>["block"],
  over: { isActive?: boolean; announceArrival?: boolean } = {},
) {
  return renderComponent(
    <RecipeFinderMessage
      block={block}
      content="Want me to make this into a recipe?"
      isActive={over.isActive ?? true}
      announceArrival={over.announceArrival}
      onAction={vi.fn()}
      onLockedButton={vi.fn()}
      onOpenItem={vi.fn()}
    />,
  );
}

const OFFER_ANNOUNCEMENT = "Recipe offer: Yes, Search, or No";
const ADJUST_ANNOUNCEMENT = "Adjust Spaghetti & meatballs, then Generate";
const QUESTIONS_ANNOUNCEMENT =
  "Recipe questions: pick answers, then Search with these";
const RESULTS_ANNOUNCEMENT = "Found 1 community recipe";

let spy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  spy = vi.spyOn(RN.AccessibilityInfo, "announceForAccessibility");
});
afterEach(() => {
  spy.mockRestore();
});

describe.each([
  ["offer", offerBlock, OFFER_ANNOUNCEMENT],
  ["adjust card", adjustBlock, ADJUST_ANNOUNCEMENT],
  ["questions card", questionsBlock, QUESTIONS_ANNOUNCEMENT],
  ["results list", resultsBlock, RESULTS_ANNOUNCEMENT],
] as const)("%s arrival announcement", (_name, makeBlock, message) => {
  it("announces once when a new live card appears", () => {
    renderCard(makeBlock(nextFlowId()));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(message);
  });

  it("does not announce again when the same card remounts", () => {
    const block = makeBlock(nextFlowId());
    const first = renderCard(block);
    first.unmount();
    renderCard(block);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("stays silent for an old, inert card", () => {
    renderCard(makeBlock(nextFlowId()), { isActive: false });
    expect(spy).not.toHaveBeenCalled();
  });

  it("stays silent in RecipeChef's pending bubble, then announces the saved row once", () => {
    const block = makeBlock(nextFlowId());
    const pending = renderCard(block, { announceArrival: false });
    expect(spy).not.toHaveBeenCalled();
    pending.unmount();
    renderCard(block);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(message);
  });
});

it("an offer and the adjust card of the same flow each announce", () => {
  const flowId = nextFlowId();
  renderCard(offerBlock(flowId)).unmount();
  renderCard(adjustBlock(flowId));
  expect(spy.mock.calls).toEqual([[OFFER_ANNOUNCEMENT], [ADJUST_ANNOUNCEMENT]]);
});
