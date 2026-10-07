// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { RecipeOffer } from "../RecipeOffer";
import type { RecipeOfferBlock } from "@shared/schemas/recipe-finder";

const FLOW = "00000000-0000-4000-8000-000000000000";
const OFFER =
  "I can make this into a recipe right here in the chat. Want me to get started?";

const block: RecipeOfferBlock = {
  type: "recipe_offer",
  flow: {
    flowId: FLOW,
    stage: "offer",
    request: "spaghetti and meatballs for 8",
    query: { q: "spaghetti and meatballs" },
    round: 0,
    shownIds: [],
    dish: "spaghetti and meatballs",
    details: { servings: 8, ingredients: [], fromConversation: false },
  },
};

describe("RecipeOffer", () => {
  it("shows the server's offer text without the old-client reply hint", () => {
    renderComponent(
      <RecipeOffer
        block={block}
        content={`${OFFER}\n\nReply "yes", "search", or "no".`}
        isActive
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByText(OFFER)).toBeDefined();
    expect(screen.queryByText(/Reply "yes"/)).toBeNull();
  });

  it.each([
    ["Yes", "offer_yes"],
    ["Search", "offer_search"],
    ["No", "offer_no"],
  ] as const)("%s sends %s with the block's flowId", (label, type) => {
    const onAction = vi.fn();
    renderComponent(
      <RecipeOffer
        block={block}
        content={OFFER}
        isActive
        onAction={onAction}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(onAction).toHaveBeenCalledWith({ type, flowId: FLOW }, label);
  });

  it("an old offer's buttons are disabled and send nothing", () => {
    const onAction = vi.fn();
    renderComponent(
      <RecipeOffer
        block={block}
        content={OFFER}
        isActive={false}
        onAction={onAction}
      />,
    );
    const yes = screen.getByRole("button", { name: "Yes" });
    expect(yes.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(yes);
    expect(onAction).not.toHaveBeenCalled();
  });
});
