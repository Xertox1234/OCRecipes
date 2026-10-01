// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { RecipeFinderMessage } from "../RecipeFinderMessage";
import type { FinderBlock } from "@shared/schemas/recipe-finder";

const FLOW = "00000000-0000-4000-8000-000000000000";
const flow = {
  flowId: FLOW,
  stage: "results" as const,
  request: "x",
  query: { q: "x" },
  round: 0 as const,
  shownIds: [],
};
const results: FinderBlock = {
  type: "recipe_results",
  source: "community",
  items: [],
  actions: ["search_online", "generate", "none_of_these"],
  notice: "no_matches",
  flow,
};
const questions: FinderBlock = {
  type: "recipe_questions",
  questions: [{ question: "Diet?", options: ["Vegan", "None"] }],
  flow: { ...flow, stage: "clarifying" },
};

function setup(
  block: FinderBlock,
  over: Partial<React.ComponentProps<typeof RecipeFinderMessage>> = {},
) {
  const onAction = vi.fn();
  const onLockedButton = vi.fn();
  renderComponent(
    <RecipeFinderMessage
      block={block}
      isActive
      onAction={onAction}
      onLockedButton={onLockedButton}
      onOpenItem={vi.fn()}
      {...over}
    />,
  );
  return { onAction, onLockedButton };
}

describe("RecipeFinderMessage", () => {
  it("sends a button action with the block's own flowId and the button label", () => {
    const { onAction } = setup(results);
    fireEvent.click(screen.getByRole("button", { name: "None of these" }));
    expect(onAction).toHaveBeenCalledWith(
      { type: "none_of_these", flowId: FLOW },
      "None of these",
    );
  });

  it("a locked button opens the upgrade path instead of sending", () => {
    const { onAction, onLockedButton } = setup(results, {
      lockedButtons: ["search_online"],
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Search Spoonacular. Premium feature",
      }),
    );
    expect(onAction).not.toHaveBeenCalled();
    expect(onLockedButton).toHaveBeenCalledWith("search_online");
  });

  it("sends answers with the chosen answers as the label", () => {
    const { onAction } = setup(questions);
    fireEvent.click(screen.getByRole("radio", { name: "Vegan" }));
    fireEvent.click(screen.getByRole("button", { name: "Search with these" }));
    expect(onAction).toHaveBeenCalledWith(
      {
        type: "answers",
        flowId: FLOW,
        answers: [{ question: "Diet?", answer: "Vegan" }],
      },
      "Vegan",
    );
  });
});
