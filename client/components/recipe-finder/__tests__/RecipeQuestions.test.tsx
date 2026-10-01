// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { RecipeQuestions } from "../RecipeQuestions";
import type { RecipeQuestionsBlock } from "@shared/schemas/recipe-finder";

const block: RecipeQuestionsBlock = {
  type: "recipe_questions",
  questions: [
    {
      question: "How much time do you have?",
      options: ["Under 20 minutes", "An hour or more"],
    },
    { question: "Any diet to follow?", options: ["No preference", "Vegan"] },
  ],
  flow: {
    flowId: "00000000-0000-4000-8000-000000000000",
    stage: "clarifying",
    request: "x",
    query: { q: "x" },
    round: 0,
    shownIds: [],
  },
};

describe("RecipeQuestions", () => {
  it("shows each question with single-select chips that expose selection", () => {
    renderComponent(
      <RecipeQuestions block={block} isActive onSubmit={vi.fn()} />,
    );
    expect(screen.getByText("How much time do you have?")).toBeDefined();
    const chip = screen.getByRole("radio", { name: "Under 20 minutes" });
    fireEvent.click(chip);
    expect(chip.getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "An hour or more" }));
    expect(
      screen
        .getByRole("radio", { name: "Under 20 minutes" })
        .getAttribute("aria-selected"),
    ).toBe("false");
  });

  it("'Search with these' is disabled until an answer is chosen, then sends partial answers", () => {
    const onSubmit = vi.fn();
    renderComponent(
      <RecipeQuestions block={block} isActive onSubmit={onSubmit} />,
    );
    const submit = screen.getByRole("button", { name: "Search with these" });
    expect(submit.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Vegan" }));
    fireEvent.click(screen.getByRole("button", { name: "Search with these" }));
    expect(onSubmit).toHaveBeenCalledWith([
      { question: "Any diet to follow?", answer: "Vegan" },
    ]);
  });

  it("an old question set is inert", () => {
    const onSubmit = vi.fn();
    renderComponent(
      <RecipeQuestions block={block} isActive={false} onSubmit={onSubmit} />,
    );
    // Chips render without onPress (static) — no radio controls to press.
    expect(screen.queryByRole("radio", { name: "Vegan" })).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Search with these" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("tells the user typing works too", () => {
    renderComponent(
      <RecipeQuestions block={block} isActive onSubmit={vi.fn()} />,
    );
    expect(screen.getByText("Or type your answer.")).toBeDefined();
  });
});
