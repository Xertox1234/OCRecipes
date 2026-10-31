// @vitest-environment jsdom
import React from "react";
import { fireEvent, screen } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import CoachDashboard from "../CoachDashboard";
import type { CoachContextData } from "@/hooks/useCoachContext";

vi.mock("@/lib/feature-tips-storage", () => ({
  hasUsedFeature: () => true,
}));

type NotebookEntry = CoachContextData["notebook"][number];

const context: CoachContextData = {
  goals: { calories: 1949, protein: 146, carbs: 200, fat: 60 },
  todayIntake: {
    totalCalories: 420,
    totalProtein: 12,
    totalCarbs: 40,
    totalFat: 10,
  },
  dietaryProfile: null,
  notebook: [
    {
      id: 1,
      type: "insight",
      content: "Pumpkin seeds add iron",
    } as NotebookEntry,
  ],
  dueCommitments: [],
  suggestions: ["How was my week?"],
};

function renderDashboard(onNotebookPress = vi.fn()) {
  renderComponent(
    <CoachDashboard
      context={context}
      onSuggestionPress={vi.fn()}
      onNotebookPress={onNotebookPress}
    />,
  );
  return onNotebookPress;
}

describe("CoachDashboard", () => {
  it("opens with the stats, tips and suggestions showing", () => {
    renderDashboard();
    expect(screen.getByText("Calories")).toBeTruthy();
    expect(screen.getByText("Pumpkin seeds add iron")).toBeTruthy();
    expect(screen.getByText("How was my week?")).toBeTruthy();
  });

  it("the top row always carries today's calories against the goal", () => {
    renderDashboard();
    expect(screen.getByText("420 / 1,949 cal")).toBeTruthy();
  });

  // Folding must free the room for the chat: everything below the top row
  // goes, the stat boxes included.
  it("folding leaves only the top row", () => {
    renderDashboard();
    fireEvent.click(screen.getByRole("button", { name: "Collapse dashboard" }));

    expect(screen.queryByText("Calories")).toBeNull();
    expect(screen.queryByText("Pumpkin seeds add iron")).toBeNull();
    expect(screen.queryByText("How was my week?")).toBeNull();
    expect(screen.getByText("420 / 1,949 cal")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Expand dashboard" }),
    ).toBeTruthy();
  });

  it("the Notebook button sits in the top row and opens the notebook", () => {
    const onNotebookPress = renderDashboard();
    fireEvent.click(screen.getByRole("button", { name: "Collapse dashboard" }));
    fireEvent.click(screen.getByRole("button", { name: "Open notebook" }));
    expect(onNotebookPress).toHaveBeenCalledTimes(1);
  });

  it("with no goals set, the top row shows calories alone", () => {
    renderComponent(
      <CoachDashboard
        context={{ ...context, goals: null }}
        onSuggestionPress={vi.fn()}
        onNotebookPress={vi.fn()}
      />,
    );
    expect(screen.getByText("420 cal")).toBeTruthy();
  });
});
